const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const multer = require('multer');
require('dotenv').config();

// Models
const Livestock = require('./models/Livestock');
const Order = require('./models/Order');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-123';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/livestockmart';

const connectDB = async () => {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB');
    } catch (err) { console.error('❌ MongoDB Connection Error:', err); }
};
connectDB();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

function authMiddleware(req, res, next) {
    const token = req.cookies && req.cookies.token;
    if (!token) return res.status(401).json({ message: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) { return res.status(401).json({ message: 'Invalid token' }); }
}

// --- AUTH ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const newUser = new User({ name, email, password });
        await newUser.save();
        const token = jwt.sign({ id: newUser._id, name: newUser.name, email: newUser.email }, JWT_SECRET);
        res.cookie('token', token, { httpOnly: true }).json({ user: { id: newUser._id, name: newUser.name } });
    } catch (err) { res.status(500).json({ message: 'Error registering' }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !(await user.comparePassword(password))) return res.status(400).json({ message: 'Invalid credentials' });
        const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, JWT_SECRET);
        res.cookie('token', token, { httpOnly: true }).json({ user: { id: user._id, name: user.name } });
    } catch (err) { res.status(500).json({ message: 'Error logging in' }); }
});

app.get('/api/auth/me', authMiddleware, (req, res) => res.json({ user: req.user }));
app.post('/api/auth/logout', (req, res) => res.clearCookie('token').json({ message: 'Logged out' }));

// --- STATE ---
app.get('/api/user/state', authMiddleware, async (req, res) => {
    const user = await User.findById(req.user.id);
    res.json({ cart: user.cart, wishlist: user.wishlist, addresses: user.addresses, notifications: user.notifications });
});

app.put('/api/user/state', authMiddleware, async (req, res) => {
    const { cart, wishlist, addresses, notifications } = req.body;
    await User.findByIdAndUpdate(req.user.id, { $set: { cart, wishlist, addresses, notifications } });
    res.json({ success: true });
});

// --- LIVESTOCK ---
app.get('/api/livestock', async (req, res) => {
    const livestock = await Livestock.find({}, '-image');
    res.json(livestock);
});

app.get('/api/livestock/image/:id', async (req, res) => {
    const item = await Livestock.findById(req.params.id);
    if(item && item.image) {
        res.set('Content-Type', item.image.contentType);
        res.send(item.image.data);
    } else res.status(404).send('Not found');
});

// --- ADMIN ---
app.get('/api/admin/livestock', async (req, res) => {
    const livestock = await Livestock.find({});
    res.json({ livestock });
});

app.post('/api/admin/livestock', upload.single('image'), async (req, res) => {
    const { name, type, breed, price, status, weight, tags } = req.body;
    const newItem = new Livestock({
        name, type, breed, weight, price, status, tags: tags.split(','),
        age: weight + ' kg',
        image: req.file ? { data: req.file.buffer, contentType: req.file.mimetype } : undefined
    });
    await newItem.save();
    res.json(newItem);
});

app.get('/api/admin/orders', async (req, res) => {
    const orders = await Order.find({}).sort({ createdAt: -1 });
    res.json({ orders });
});

app.get('/api/admin/orders/proof/:id', async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (!order || !order.paymentProof) return res.status(404).send('No proof');
    res.set('Content-Type', order.paymentProof.contentType);
    res.send(order.paymentProof.data);
});

app.put('/api/admin/orders/:id/reject', async (req, res) => {
    const { reason } = req.body;
    const order = await Order.findByIdAndUpdate(req.params.id, { status: 'Payment Rejected', rejectionReason: reason }, { new: true });
    // Notify User
    await User.findByIdAndUpdate(order.userId, { 
        $push: { notifications: {
            id: 'rej_' + Date.now(), title: 'Payment Rejected', 
            message: `Order #${order._id.toString().slice(-6)} needs new proof: ${reason}`,
            icon: 'alert-circle', color: 'red', timestamp: Date.now(), seen: false
        }}
    });
    res.json({ success: true });
});

app.put('/api/admin/orders/:id', async (req, res) => {
    await Order.findByIdAndUpdate(req.params.id, { status: req.body.status });
    res.json({ success: true });
});

app.get('/api/admin/users', async (req, res) => {
    const users = await User.find({});
    res.json({ users });
});

// --- ORDERS & PAYMENT ---
app.post('/api/payment/create', authMiddleware, (req, res) => {
    res.json({ upiString: `upi://pay?pa=shop@upi&pn=LivestockMart&am=${req.body.amount}`, paymentId: 'PID'+Date.now() });
});

app.post('/api/payment/confirm', authMiddleware, (req, res) => res.json({ success: true }));

app.post('/api/orders', authMiddleware, upload.single('paymentProof'), async (req, res) => {
    try {
        const { items, address, total, date } = req.body;
        const newOrder = new Order({
            customer: req.user.name, userId: req.user.id,
            date, total: parseFloat(total),
            items: JSON.parse(items), address: JSON.parse(address),
            paymentProof: req.file ? { data: req.file.buffer, contentType: req.file.mimetype } : undefined
        });
        await newOrder.save();
        await User.findByIdAndUpdate(req.user.id, { $set: { cart: [] } });
        res.status(201).json(newOrder);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/orders', authMiddleware, async (req, res) => {
    const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(orders);
});

app.put('/api/orders/:id/reupload', authMiddleware, upload.single('paymentProof'), async (req, res) => {
    const order = await Order.findOne({ _id: req.params.id, userId: req.user.id });
    if(req.file) {
        order.paymentProof = { data: req.file.buffer, contentType: req.file.mimetype };
        order.status = 'Processing';
        order.rejectionReason = '';
        await order.save();
        res.json({ success: true });
    } else res.status(400).send('No file');
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Server on ${PORT}`));

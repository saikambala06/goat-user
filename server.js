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
    try { await mongoose.connect(MONGODB_URI); console.log('✅ MongoDB Connected'); } 
    catch (err) { console.error('❌ MongoDB Error:', err); }
};
connectDB();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Middleware
function authMiddleware(req, res, next) {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); } 
    catch (err) { res.status(401).json({ message: 'Invalid token' }); }
}

// --- Auth Routes ---
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) return res.status(400).json({ message: 'Invalid' });
    const token = jwt.sign({ id: user._id, name: user.name }, JWT_SECRET);
    res.cookie('token', token, { httpOnly: true }).json({ user: { id: user._id, name: user.name } });
});

app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    const newUser = new User({ name, email, password });
    await newUser.save();
    const token = jwt.sign({ id: newUser._id, name: newUser.name }, JWT_SECRET);
    res.cookie('token', token, { httpOnly: true }).json({ user: { id: newUser._id, name: newUser.name } });
});

app.post('/api/auth/logout', (req, res) => res.clearCookie('token').send('Logged out'));
app.get('/api/auth/me', authMiddleware, (req, res) => res.json({ user: req.user }));

// --- User State ---
app.get('/api/user/state', authMiddleware, async (req, res) => {
    const user = await User.findById(req.user.id);
    res.json({ cart: user.cart, wishlist: user.wishlist, addresses: user.addresses, notifications: user.notifications });
});

app.put('/api/user/state', authMiddleware, async (req, res) => {
    await User.findByIdAndUpdate(req.user.id, { $set: req.body });
    res.json({ success: true });
});

// --- Livestock ---
app.get('/api/livestock', async (req, res) => {
    const items = await Livestock.find({}, '-image');
    res.json(items);
});

app.get('/api/livestock/image/:id', async (req, res) => {
    const item = await Livestock.findById(req.params.id);
    if(item?.image) { res.set('Content-Type', item.image.contentType); res.send(item.image.data); }
    else res.status(404).send('Not found');
});

// --- Orders (With Proof Handling) ---
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
        
        // Mark items as sold
        const ids = JSON.parse(items).map(i => i._id);
        await Livestock.updateMany({ _id: { $in: ids } }, { $set: { status: 'Sold' } });
        await User.findByIdAndUpdate(req.user.id, { $set: { cart: [] } }); // Clear cart
        
        res.status(201).json(newOrder);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/orders', authMiddleware, async (req, res) => {
    const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(orders);
});

app.put('/api/orders/:id/reupload', authMiddleware, upload.single('paymentProof'), async (req, res) => {
    if(!req.file) return res.status(400).send('No file');
    await Order.findByIdAndUpdate(req.params.id, {
        status: 'Processing', rejectionReason: '',
        paymentProof: { data: req.file.buffer, contentType: req.file.mimetype }
    });
    res.json({ success: true });
});

// --- Admin Routes ---
app.get('/api/admin/orders', async (req, res) => {
    const orders = await Order.find({}).sort({ createdAt: -1 });
    res.json({ orders });
});

app.get('/api/admin/orders/proof/:id', async (req, res) => {
    const order = await Order.findById(req.params.id);
    if(order?.paymentProof) { res.set('Content-Type', order.paymentProof.contentType); res.send(order.paymentProof.data); }
    else res.status(404).send('No proof');
});

app.put('/api/admin/orders/:id/reject', async (req, res) => {
    const order = await Order.findByIdAndUpdate(req.params.id, { 
        status: 'Payment Rejected', rejectionReason: req.body.reason 
    }, { new: true });
    
    // Notify User
    await User.findByIdAndUpdate(order.userId, { 
        $push: { notifications: {
            id: Date.now().toString(), title: 'Payment Rejected', color: 'red',
            message: `Order #${order._id.toString().slice(-6)} proof rejected: ${req.body.reason}`,
            timestamp: Date.now(), seen: false
        }} 
    });
    res.json({ success: true });
});

app.put('/api/admin/orders/:id', async (req, res) => {
    await Order.findByIdAndUpdate(req.params.id, { status: req.body.status });
    res.json({ success: true });
});

// Fallback
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.listen(PORT, () => console.log(`Server running on ${PORT}`));

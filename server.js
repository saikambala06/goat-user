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
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-key-123';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/livestockmart';

// --- OPTIMIZATION: Database Connection Caching for Vercel/Serverless ---
let cachedDb = null;

const connectDB = async () => {
    if (cachedDb && mongoose.connection.readyState === 1) {
        return cachedDb;
    }
    try {
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        cachedDb = mongoose.connection;
        console.log('✅ Connected to MongoDB');
        return cachedDb;
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err);
    }
};

// Ensure DB connects on startup (for local dev)
connectDB();

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } 
});

app.use(cors({ 
    origin: true, 
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Middleware to ensure DB is connected before handling request
app.use(async (req, res, next) => {
    await connectDB();
    next();
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', uptime: process.uptime() });
});

// --- AUTH UTILS ---
function createToken(user) {
    return jwt.sign({ id: user._id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
}

function setAuthCookie(res, token) {
    res.cookie('token', token, {
        httpOnly: true,
        sameSite: 'lax', 
        secure: process.env.NODE_ENV === 'production', 
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });
}

function authMiddleware(req, res, next) {
    const token = req.cookies && req.cookies.token;
    if (!token) return res.status(401).json({ message: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = { id: decoded.id, email: decoded.email, name: decoded.name };
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
}

// --- AUTH ROUTES ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) return res.status(400).json({ message: 'All fields required' });

        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(409).json({ message: 'Email already exists' });

        const newUser = new User({ name, email, password });
        await newUser.save();

        const token = createToken(newUser);
        setAuthCookie(res, token);
        res.status(201).json({ user: { id: newUser._id, name: newUser.name, email: newUser.email } });
    } catch (err) {
        console.error('Registration Error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ message: 'Credentials required' });

        const user = await User.findOne({ email });
        if (!user || !(await user.comparePassword(password))) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const token = createToken(user);
        setAuthCookie(res, token);
        res.json({ user: { id: user._id, name: user.name, email: user.email } });
    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({ user: req.user });
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'Logged out' });
});

// --- USER DATA ROUTES ---
app.get('/api/user/state', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json({ 
            cart: user.cart || [], 
            wishlist: user.wishlist || [], 
            addresses: user.addresses || [],
            notifications: user.notifications || [] 
        });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.put('/api/user/state', authMiddleware, async (req, res) => {
    try {
        const { cart, wishlist, addresses, notifications } = req.body;
        await User.findByIdAndUpdate(req.user.id, { $set: { cart, wishlist, addresses, notifications } });
        res.json({ success: true });
    } catch (err) { 
        res.status(400).json({ error: 'Failed to save state' }); 
    }
});

// --- FIX: Missing Notification Route ---
app.get('/api/notifications', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id, 'notifications');
        res.json(user ? user.notifications : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- LIVESTOCK ROUTES ---
app.get('/api/livestock', async (req, res) => {
    try {
        // Optimization: Only select needed fields, exclude heavy images
        const livestock = await Livestock.find({}, '-image'); 
        res.json(livestock);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/livestock/image/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).send('Invalid ID');
        
        const livestock = await Livestock.findById(req.params.id, 'image');
        if (!livestock || !livestock.image || !livestock.image.data) return res.status(404).send('Image not found');
        
        // --- OPTIMIZATION: Browser Caching for Images (24 hours) ---
        res.set('Cache-Control', 'public, max-age=86400'); 
        res.set('Content-Type', livestock.image.contentType);
        res.send(livestock.image.data);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// --- ADMIN ROUTES ---
app.get('/api/admin/livestock', async (req, res) => {
    try {
        const livestock = await Livestock.find({}).sort({ createdAt: -1 });
        res.json({ livestock });
    } catch (err) {
        res.status(500).json({ message: 'Failed to load livestock' });
    }
});

app.post('/api/admin/livestock', upload.single('image'), async (req, res) => {
    try {
        const { name, type, breed, age, price, tags, status, weight } = req.body;
        const image = req.file ? { data: req.file.buffer, contentType: req.file.mimetype } : undefined;
        let tagArray = tags && typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(t => t.length > 0) : [];

        const newItem = new Livestock({
            name, type, breed, age, 
            weight: weight || "N/A", 
            price: parseFloat(price) || 0,
            tags: tagArray, 
            status: status || 'Available', 
            image
        });

        await newItem.save();
        res.status(201).json(newItem);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/livestock/:id', upload.single('image'), async (req, res) => {
    try {
        const updates = { ...req.body };
        if (updates.price) updates.price = parseFloat(updates.price);
        if (req.file) updates.image = { data: req.file.buffer, contentType: req.file.mimetype };
        if (updates.tags && typeof updates.tags === 'string') updates.tags = updates.tags.split(',').map(t => t.trim());

        const livestock = await Livestock.findByIdAndUpdate(req.params.id, updates, { new: true });
        res.json(livestock);
    } catch (err) {
        res.status(500).json({ message: 'Update failed' });
    }
});

app.delete('/api/admin/livestock/:id', async (req, res) => {
    try {
        await Livestock.findByIdAndDelete(req.params.id);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ message: 'Delete failed' });
    }
});

app.get('/api/admin/orders', async (req, res) => {
    try {
        const orders = await Order.find({}).sort({ createdAt: -1 });
        res.json({ orders });
    } catch (err) {
        res.status(500).json({ message: 'Failed to load orders' });
    }
});

// View Proof
app.get('/api/admin/orders/proof/:id', async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order || !order.paymentProof || !order.paymentProof.data) return res.status(404).send('No proof found');
        
        res.set('Cache-Control', 'public, max-age=3600'); // Cache proof for 1 hour
        res.set('Content-Type', order.paymentProof.contentType);
        res.send(order.paymentProof.data);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// Reject Payment
app.put('/api/admin/orders/:id/reject', async (req, res) => {
    try {
        const { reason } = req.body;
        const order = await Order.findByIdAndUpdate(
            req.params.id, 
            { status: 'Payment Rejected', rejectionReason: reason || 'Invalid payment proof.' }, 
            { new: true }
        );
        if (!order) return res.status(404).json({ message: 'Order not found' });

        await User.findByIdAndUpdate(order.userId, { 
            $push: { notifications: {
                id: 'rej_' + Date.now(), 
                title: 'Payment Rejected', 
                message: `Order #${order._id.toString().slice(-6)} proof rejected: ${reason}`,
                icon: 'alert-circle', color: 'red', timestamp: Date.now(), seen: false
            }}
        });
        res.json({ success: true });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.put('/api/admin/orders/:id', async (req, res) => {
    try {
        const order = await Order.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
        res.json(order);
    } catch (err) {
        res.status(500).json({ message: 'Update failed' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await User.find({}, 'name email createdAt').sort({ createdAt: -1 });
        res.json({ users });
    } catch (err) {
        res.status(500).json({ message: 'Failed to load users' });
    }
});

// --- ORDER ROUTES ---
app.get('/api/orders', authMiddleware, async (req, res) => {
    try {
        const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/orders/:id/reupload', authMiddleware, upload.single('paymentProof'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send('No file uploaded');
        const order = await Order.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { 
                status: 'Processing', 
                rejectionReason: '', 
                paymentProof: { data: req.file.buffer, contentType: req.file.mimetype } 
            }
        );
        if(!order) return res.status(404).send('Order not found');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Re-upload failed' });
    }
});

app.post('/api/orders', authMiddleware, upload.single('paymentProof'), async (req, res) => {
    try {
        const items = req.body.items ? JSON.parse(req.body.items) : [];
        const address = req.body.address ? JSON.parse(req.body.address) : {};
        const total = req.body.total;
        const date = req.body.date;
        const paymentProof = req.file ? { data: req.file.buffer, contentType: req.file.mimetype } : undefined;

        const newOrder = new Order({ 
            items, address, total, date, paymentProof, 
            userId: req.user.id, customer: req.user.name 
        });
        await newOrder.save();

        // Mark sold items
        const itemIds = items.map(item => item._id);
        if (itemIds.length > 0) {
            await Livestock.updateMany({ _id: { $in: itemIds } }, { $set: { status: 'Sold' } });
        }
        // Clear Cart
        await User.findByIdAndUpdate(req.user.id, { $set: { cart: [] } });
        res.status(201).json(newOrder);
    } catch (err) {
        res.status(500).json({ error: 'Order creation failed' });
    }
});

app.put('/api/orders/:id/cancel', authMiddleware, async (req, res) => {
    try {
        const order = await Order.findOne({ _id: req.params.id, userId: req.user.id });
        if (!order || order.status !== 'Processing') return res.status(400).json({ message: 'Cannot cancel order' });

        order.status = 'Cancelled';
        await order.save();
        const itemIds = order.items.map(item => item._id);
        if (itemIds.length > 0) {
            await Livestock.updateMany({ _id: { $in: itemIds } }, { $set: { status: 'Available' } });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: 'Cancellation failed' });
    }
});

// --- PAYMENT ---
app.post('/api/payment/create', authMiddleware, (req, res) => {
    const { amount } = req.body;
    const paymentId = 'PAY_' + Date.now();
    const upiString = `upi://pay?pa=${process.env.UPI_ID || 'shop@upi'}&pn=LivestockMart&am=${amount}`;
    res.json({ upiString, paymentId });
});

app.post('/api/payment/confirm', authMiddleware, (req, res) => res.json({ success: true }));

// --- FALLBACK ---
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

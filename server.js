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
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-key-123';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/livestockmart';

// --- Global MongoDB Connection Cache for Serverless (Vercel Optimization) ---
let cachedConnection = null;

const connectDB = async () => {
    if (cachedConnection && cachedConnection.readyState === 1) {
        return cachedConnection;
    }
    try {
        cachedConnection = await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
        });
        console.log('✅ MongoDB Connected (cached)');
        return cachedConnection;
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err);
        // Do not exit process in serverless; just throw so the request fails cleanly
        throw err;
    }
};

// Initialize DB connection immediately
connectDB().catch(console.error);

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

// --- HEALTH CHECK ---
app.get('/health', (req, res) => {
    const dbStatus = mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected';
    res.status(200).json({ status: 'UP', database: dbStatus });
});

// --- HELPER FUNCTIONS ---
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
    await connectDB(); // Ensure DB is connected
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
        res.status(500).json({ message: 'Server error during registration' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    await connectDB();
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ message: 'Credentials required' });

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'Invalid credentials' });

        const isMatch = await user.comparePassword(password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

        const token = createToken(user);
        setAuthCookie(res, token);
        res.json({ user: { id: user._id, name: user.name, email: user.email } });
    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({ message: 'Server error during login' });
    }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({ user: req.user });
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'Logged out' });
});

// --- USER STATE ROUTES ---
app.get('/api/user/state', authMiddleware, async (req, res) => {
    await connectDB();
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
        console.error("Get State Error:", err);
        res.status(500).json({ error: err.message }); 
    }
});

app.put('/api/user/state', authMiddleware, async (req, res) => {
    await connectDB();
    try {
        const { cart, wishlist, addresses, notifications } = req.body;
        
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id, 
            { $set: { cart, wishlist, addresses, notifications } },
            { new: true } 
        );
        
        if (!updatedUser) return res.status(404).json({ message: 'User not found' });
        res.json({ message: 'State synchronized', success: true });
    } catch (err) { 
        console.error("Sync State Error:", err); 
        res.status(400).json({ error: 'Failed to save state', details: err.message }); 
    }
});

// --- LIVESTOCK ROUTES ---
app.get('/api/livestock', async (req, res) => {
    await connectDB();
    try {
        const livestock = await Livestock.find({}, '-image'); 
        res.json(livestock);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/livestock/image/:id', async (req, res) => {
    await connectDB();
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).send('Invalid ID');
        
        const livestock = await Livestock.findById(req.params.id, 'image');
        if (!livestock || !livestock.image || !livestock.image.data) return res.status(404).send('Image not found');
        
        res.set('Content-Type', livestock.image.contentType);
        res.send(livestock.image.data);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// --- ADMIN ROUTES ---
app.get('/api/admin/livestock', async (req, res) => {
    await connectDB();
    try {
        const livestock = await Livestock.find({}).sort({ createdAt: -1 });
        res.json({ livestock });
    } catch (err) {
        res.status(500).json({ message: 'Failed to load livestock' });
    }
});

app.post('/api/admin/livestock', upload.single('image'), async (req, res) => {
    await connectDB();
    try {
        const { name, type, breed, age, price, tags, status, weight } = req.body;
        if (!name || !type || !price) return res.status(400).json({ message: 'Missing required fields' });

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
    await connectDB();
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
        
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
    await connectDB();
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
        await Livestock.findByIdAndDelete(req.params.id);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ message: 'Delete failed' });
    }
});

app.get('/api/admin/orders', async (req, res) => {
    await connectDB();
    try {
        const orders = await Order.find({}).sort({ createdAt: -1 });
        res.json({ orders });
    } catch (err) {
        res.status(500).json({ message: 'Failed to load orders' });
    }
});

app.get('/api/admin/orders/proof/:id', async (req, res) => {
    await connectDB();
    try {
        const order = await Order.findById(req.params.id);
        if (!order || !order.paymentProof || !order.paymentProof.data) return res.status(404).send('No proof found');
        
        res.set('Content-Type', order.paymentProof.contentType);
        res.send(order.paymentProof.data);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

app.put('/api/admin/orders/:id/reject', async (req, res) => {
    await connectDB();
    try {
        const { reason } = req.body;
        const order = await Order.findByIdAndUpdate(
            req.params.id, 
            { 
                status: 'Payment Rejected', 
                rejectionReason: reason || 'Invalid payment proof.'
            }, 
            { new: true }
        );
        
        if (!order) return res.status(404).json({ message: 'Order not found' });

        await User.findByIdAndUpdate(order.userId, { 
            $push: { notifications: {
                id: 'rej_' + Date.now(), 
                title: 'Payment Rejected', 
                message: `Order #${order._id.toString().slice(-6)} proof rejected: ${reason}`,
                icon: 'alert-circle', 
                color: 'red', 
                timestamp: Date.now(), 
                seen: false
            }}
        });

        res.json({ success: true, message: 'Order rejected and user notified' });
    } catch (err) { 
        console.error("Reject Error:", err);
        res.status(500).json({ error: err.message }); 
    }
});

app.put('/api/admin/orders/:id', async (req, res) => {
    await connectDB();
    try {
        const order = await Order.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
        res.json(order);
    } catch (err) {
        res.status(500).json({ message: 'Update failed' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    await connectDB();
    try {
        const users = await User.find({}, 'name email createdAt').sort({ createdAt: -1 });
        res.json({ users });
    } catch (err) {
        res.status(500).json({ message: 'Failed to load users' });
    }
});

// --- ORDER ROUTES ---
app.get('/api/orders', authMiddleware, async (req, res) => {
    await connectDB();
    try {
        const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/orders/:id/reupload', authMiddleware, upload.single('paymentProof'), async (req, res) => {
    await connectDB();
    try {
        if (!req.file) return res.status(400).send('No file uploaded');

        const order = await Order.findOne({ _id: req.params.id, userId: req.user.id });
        if (!order) return res.status(404).json({ message: 'Order not found' });

        await Order.findByIdAndUpdate(req.params.id, {
            status: 'Processing',
            rejectionReason: '',
            paymentProof: { 
                data: req.file.buffer, 
                contentType: req.file.mimetype 
            }
        });
        
        res.json({ success: true, message: 'Proof re-uploaded successfully' });
    } catch (err) {
        console.error("Re-upload Error:", err);
        res.status(500).json({ message: 'Re-upload failed' });
    }
});

app.post('/api/orders', authMiddleware, upload.single('paymentProof'), async (req, res) => {
    await connectDB();
    try {
        const items = req.body.items ? JSON.parse(req.body.items) : [];
        const address = req.body.address ? JSON.parse(req.body.address) : {};
        const total = req.body.total;
        const date = req.body.date;

        const paymentProof = req.file ? {
            data: req.file.buffer,
            contentType: req.file.mimetype
        } : undefined;

        const newOrder = new Order({ 
            items,
            address,
            total,
            date,
            paymentProof,
            userId: req.user.id, 
            customer: req.user.name 
        });
        await newOrder.save();

        const itemIds = items.map(item => item._id);
        if (itemIds.length > 0) {
            await Livestock.updateMany(
                { _id: { $in: itemIds } }, 
                { $set: { status: 'Sold' } }
            );
        }

        await User.findByIdAndUpdate(req.user.id, { $set: { cart: [] } });
        
        res.status(201).json(newOrder);
    } catch (err) {
        console.error("Order Create Error:", err);
        res.status(500).json({ error: 'Order creation failed' });
    }
});

app.put('/api/orders/:id/cancel', authMiddleware, async (req, res) => {
    await connectDB();
    try {
        const order = await Order.findOne({ _id: req.params.id, userId: req.user.id });
        if (!order) return res.status(404).json({ message: 'Order not found' });
        if (order.status !== 'Processing') return res.status(400).json({ message: 'Cannot cancel order' });

        order.status = 'Cancelled';
        await order.save();

        const itemIds = order.items.map(item => item._id);
        if (itemIds.length > 0) {
            await Livestock.updateMany(
                { _id: { $in: itemIds } }, 
                { $set: { status: 'Available' } }
            );
        }

        res.json({ success: true, message: 'Order cancelled & items restocked' });
    } catch (err) {
        console.error('Cancel Error:', err);
        res.status(500).json({ message: 'Cancellation failed' });
    }
});

// --- PAYMENT ROUTES ---
app.post('/api/payment/create', authMiddleware, (req, res) => {
    const { amount } = req.body;
    const paymentId = 'PAY_' + Date.now();
    const upiString = `upi://pay?pa=${process.env.UPI_ID || 'sai.kambala@ybl'}&pn=LivestockMart&am=${amount}`;
    res.json({ upiString, paymentId });
});

app.post('/api/payment/confirm', authMiddleware, (req, res) => res.json({ success: true }));

// --- FALLBACK HANDLERS ---
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Catch-all for other static requests (e.g. if you have other pages)
app.get('*', (req, res) => {
    if (req.accepts('html')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).send('Not Found');
    }
});

// --- DUAL STARTUP STRATEGY ---

// 1. If running locally (node server.js), this block runs.
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Server running locally on port ${PORT}`);
    });
}

// 2. Export app for Vercel (Serverless)
module.exports = app;

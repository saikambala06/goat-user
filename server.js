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

// --- Database Connection ---
const connectDB = async () => {
    try {
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000, 
            socketTimeoutMS: 45000, 
        });
        console.log('✅ Connected to MongoDB');
    } catch (err) {
        console.error('❌ Initial MongoDB Connection Error:', err);
    }
};

mongoose.connection.on('disconnected', () => console.warn('⚠️ MongoDB disconnected! Attempting reconnect...'));
mongoose.connection.on('reconnected', () => console.log('✅ MongoDB reconnected'));
mongoose.connection.on('error', (err) => console.error('❌ MongoDB connection error:', err));

connectDB();

// --- Middleware ---
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

// --- Helpers ---
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

// --- SYSTEM ROUTES ---
app.get('/health', (req, res) => {
    const dbStatus = mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected';
    res.status(200).json({ status: 'UP', uptime: process.uptime(), database: dbStatus });
});

// Fix for 404 spam (Merged from snippet)
app.get('/api/notifications', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        res.json(user ? user.notifications : []);
    } catch (err) {
        res.json([]);
    }
});

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
        res.status(500).json({ message: 'Server error during registration' });
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
        res.json({ message: 'State synchronized', success: true });
    } catch (err) { 
        res.status(400).json({ error: 'Failed to save state' }); 
    }
});

// --- LIVESTOCK ROUTES ---
app.get('/api/livestock', async (req, res) => {
    try {
        // Merged Fix: Use lean() and ensure array return to prevent crashes
        const livestock = await Livestock.find({}, '-image').lean(); 
        res.json(Array.isArray(livestock) ? livestock : []);
    } catch (err) {
        console.error("Fetch Livestock Error:", err);
        res.json([]); // Fallback to empty array
    }
});

app.get('/api/livestock/image/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).send('Invalid ID');
        const livestock = await Livestock.findById(req.params.id, 'image');
        if (!livestock?.image?.data) return res.status(404).send('Image not found');
        
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
        let tagArray = tags && typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : [];

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

// --- ORDER ROUTES (Admin & User) ---
app.get('/api/orders', authMiddleware, async (req, res) => {
    try {
        const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/orders', authMiddleware, upload.single('paymentProof'), async (req, res) => {
    try {
        const items = req.body.items ? JSON.parse(req.body.items) : [];
        const address = req.body.address ? JSON.parse(req.body.address) : {};
        const paymentProof = req.file ? { data: req.file.buffer, contentType: req.file.mimetype } : undefined;

        const newOrder = new Order({ 
            items, address, 
            total: req.body.total, 
            date: req.body.date, 
            paymentProof,
            userId: req.user.id, 
            customer: req.user.name 
        });
        await newOrder.save();

        // Mark items as Sold
        const itemIds = items.map(item => item._id);
        if (itemIds.length) await Livestock.updateMany({ _id: { $in: itemIds } }, { $set: { status: 'Sold' } });

        // Clear Cart
        await User.findByIdAndUpdate(req.user.id, { $set: { cart: [] } });
        res.status(201).json(newOrder);
    } catch (err) {
        console.error("Order Error:", err);
        res.status(500).json({ error: 'Order creation failed' });
    }
});

// Admin Order Management
app.get('/api/admin/orders', async (req, res) => res.json({ orders: await Order.find({}).sort({ createdAt: -1 }) }));
app.get('/api/admin/orders/proof/:id', async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (!order?.paymentProof?.data) return res.status(404).send('No proof');
    res.set('Content-Type', order.paymentProof.contentType).send(order.paymentProof.data);
});

// Payment Reject Logic
app.put('/api/admin/orders/:id/reject', async (req, res) => {
    try {
        const { reason } = req.body;
        const order = await Order.findByIdAndUpdate(req.params.id, 
            { status: 'Payment Rejected', rejectionReason: reason || 'Invalid payment proof.' }, 
            { new: true }
        );
        // Push notification to user
        if (order) {
            await User.findByIdAndUpdate(order.userId, { 
                $push: { notifications: {
                    id: 'rej_' + Date.now(), title: 'Payment Rejected', 
                    message: `Order #${order._id.toString().slice(-6)} proof rejected: ${reason}`,
                    icon: 'alert-circle', color: 'red', timestamp: Date.now(), seen: false
                }}
            });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/orders/:id', async (req, res) => {
    const order = await Order.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    res.json(order);
});

// --- FALLBACK HANDLERS ---
app.get('/api/(.*)', (req, res) => res.status(404).json({ message: 'API Route not found' }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

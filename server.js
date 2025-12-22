const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const multer = require('multer');
require('dotenv').config();

// --- CRITICAL: ENSURE THESE FILES EXIST IN A 'models' FOLDER ---
const Livestock = require('./models/Livestock');
const Order = require('./models/Order');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

// Multer config (Limit file size to 5MB)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } 
});

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Database Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/livestockmart';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch((err) => console.error('❌ MongoDB Connection Error:', err));

// --- AUTH HELPERS ---
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
        res.status(500).json({ message: 'Server error during registration' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ message: 'Credentials required' });

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'Invalid credentials' });

        if (typeof user.comparePassword !== 'function') {
            console.error("CRITICAL: User model missing comparePassword method.");
            return res.status(500).json({ message: 'Server configuration error' });
        }

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

// --- ADMIN API ROUTES ---

app.get('/api/admin/livestock', async (req, res) => {
    try {
        const livestock = await Livestock.find({}).sort({ createdAt: -1 });
        res.json({ livestock });
    } catch (err) {
        res.status(500).json({ message: 'Failed to load livestock' });
    }
});

// POST Livestock (Admin)
app.post('/api/admin/livestock', upload.single('image'), async (req, res) => {
    try {
        const { name, type, breed, age, price, tags, status, weight } = req.body;

        if (!name || !type || !price) return res.status(400).json({ message: 'Missing required fields' });

        const image = req.file ? { data: req.file.buffer, contentType: req.file.mimetype } : undefined;
        
        let tagArray = [];
        if (tags && typeof tags === 'string') {
            tagArray = tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
        }

        const newItem = new Livestock({
            name, type, breed, age, 
            weight: weight || "N/A", 
            price: parseFloat(price) || 0,
            tags: tagArray, 
            status, image
        });

        await newItem.save();
        res.status(201).json(newItem);
    } catch (err) {
        console.error('Add Livestock Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT Livestock (Admin)
app.put('/api/admin/livestock/:id', upload.single('image'), async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });

        const { name, type, breed, age, price, tags, status, weight } = req.body;
        
        const updates = { 
            name, type, breed, age, 
            weight,
            price: parseFloat(price) || 0, 
            status 
        };

        if (tags) {
            updates.tags = typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags;
        }

        if (req.file) {
            updates.image = { data: req.file.buffer, contentType: req.file.mimetype };
        }

        const livestock = await Livestock.findByIdAndUpdate(req.params.id, updates, { new: true });
        if (!livestock) return res.status(404).json({ message: "Item not found" });

        res.json(livestock);
    } catch (err) {
        console.error('Update Livestock Error:', err);
        res.status(500).json({ message: 'Server error updating' });
    }
});

app.delete('/api/admin/livestock/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
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

app.put('/api/admin/orders/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });
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

// --- PUBLIC/USER ROUTES ---

app.get('/api/livestock', async (req, res) => {
    try {
        const livestock = await Livestock.find({ status: 'Available' }, '-image'); 
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
        
        res.set('Content-Type', livestock.image.contentType);
        res.send(livestock.image.data);
    } catch (err) {
        console.error('Image Error:', err);
        res.status(500).send('Server Error');
    }
});

app.get('/api/orders', authMiddleware, async (req, res) => {
    try {
        const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ✅ ADDED: Cancel Order Route (Fixes the "Unexpected token <" error)
app.put('/api/orders/:id/cancel', authMiddleware, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid Order ID' });
        }

        const order = await Order.findOne({ _id: req.params.id, userId: req.user.id });

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Only allow cancellation if status is 'Processing'
        if (order.status !== 'Processing') {
            return res.status(400).json({ message: 'Cannot cancel order that has already been shipped or delivered' });
        }

        order.status = 'Cancelled';
        await order.save();
        res.json({ message: 'Order cancelled successfully', order });
    } catch (err) {
        console.error('Cancel Order Error:', err);
        res.status(500).json({ error: 'Failed to cancel order' });
    }
});

app.post('/api/orders', authMiddleware, async (req, res) => {
    try {
        const newOrder = new Order({ ...req.body, userId: req.user.id, customer: req.user.name });
        await newOrder.save();
        await User.findByIdAndUpdate(req.user.id, { $set: { cart: [] } });
        res.status(201).json(newOrder);
    } catch (err) {
        console.error('Order Error:', err);
        res.status(500).json({ error: 'Order creation failed' });
    }
});

app.get('/api/user/state', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        res.json({ cart: user.cart || [], wishlist: user.wishlist || [], addresses: user.addresses || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/user/state', authMiddleware, async (req, res) => {
    try {
        const { cart, wishlist, addresses } = req.body;
        await User.findByIdAndUpdate(req.user.id, { $set: { cart, wishlist, addresses } });
        res.json({ message: 'State updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ✅ ADDED: Notifications Route (Fixes the 404 errors)
app.get('/api/notifications', authMiddleware, (req, res) => {
    // Returning empty array to stop console errors.
    res.json([]); 
});

app.post('/api/payment/create', authMiddleware, (req, res) => {
    try {
        const { amount } = req.body;
        const paymentId = 'PAY_' + Date.now();
        const upiString = `upi://pay?pa=${process.env.UPI_ID || 'sai.kambala@ybl'}&pn=LivestockMart&am=${amount}`;
        res.json({ upiString, paymentId });
    } catch (err) {
        res.status(500).json({ message: 'Payment Error' });
    }
});

app.post('/api/payment/confirm', authMiddleware, (req, res) => res.json({ success: true }));

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ message: `Upload error: ${err.message}` });
    }
    console.error('Global Error:', err);
    res.status(500).json({ message: 'Internal Server Error' });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

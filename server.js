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
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Database Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/livestockmart';

mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// --- AUTH HELPERS ---

function createToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
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
  if (!token) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
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
    if (!name || !email || !password) return res.status(400).json({ message: 'Required fields missing' });
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(409).json({ message: 'User already exists' });

    const newUser = new User({ name, email, password });
    await newUser.save();
    const token = createToken(newUser);
    setAuthCookie(res, token);
    res.status(201).json({ user: { id: newUser._id, name: newUser.name, email: newUser.email } });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Required fields missing' });
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) return res.status(400).json({ message: 'Invalid credentials' });

    const token = createToken(user);
    setAuthCookie(res, token);
    res.json({ user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.json({ message: 'Logged out' });
});


// --- ADMIN ROUTES ---

app.get('/api/admin/livestock', async (req, res) => {
    try {
        const livestock = await Livestock.find({}).sort({ createdAt: -1 });
        res.json({ livestock });
    } catch (err) {
        res.status(500).json({ message: 'Error loading livestock' });
    }
});

app.post('/api/admin/livestock', upload.single('image'), async (req, res) => {
    try {
        const { name, type, breed, age, price, tags, status } = req.body;
        if (!type) return res.status(400).json({ message: 'Type required' });
        
        const image = req.file ? { data: req.file.buffer, contentType: req.file.mimetype } : undefined;
        const newItem = new Livestock({
            name, type, breed, age, price, tags: tags ? tags.split(',') : [], status, image
        });
        await newItem.save();
        res.status(201).json(newItem);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/livestock/:id', upload.single('image'), async (req, res) => {
    try {
        const updates = { ...req.body, price: parseFloat(req.body.price) };
        if (req.body.tags) updates.tags = typeof req.body.tags === 'string' ? req.body.tags.split(',') : req.body.tags;
        if (req.file) updates.image = { data: req.file.buffer, contentType: req.file.mimetype };

        const livestock = await Livestock.findByIdAndUpdate(req.params.id, updates, { new: true });
        if (!livestock) return res.status(404).json({ message: "Not found" });
        res.json(livestock);
    } catch (err) {
        res.status(500).json({ message: 'Error updating' });
    }
});

app.delete('/api/admin/livestock/:id', async (req, res) => {
    try {
        await Livestock.findByIdAndDelete(req.params.id);
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ message: 'Error deleting' });
    }
});

app.get('/api/admin/orders', async (req, res) => {
    try {
        const orders = await Order.find({}).sort({ createdAt: -1 });
        res.json({ orders });
    } catch (err) {
        res.status(500).json({ message: 'Error loading orders' });
    }
});

app.put('/api/admin/orders/:id', async (req, res) => {
    try {
        const { status } = req.body;
        const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
        res.json(order);
    } catch (err) {
        res.status(500).json({ message: 'Error updating order' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await User.find({}, 'name email createdAt').sort({ createdAt: -1 });
        res.json({ users });
    } catch (err) {
        res.status(500).json({ message: 'Error loading users' });
    }
});

// --- PUBLIC/USER ROUTES ---

app.get('/api/livestock', async (req, res) => {
  try {
    // FIX: Fetch both Available and Sold items so we can display Sold items in the UI (but disable them)
    // We filter out deleted or other statuses if needed, but for now show everything except hidden ones if any.
    // Ideally, users want to see "Sold" items to know market activity.
    const livestock = await Livestock.find({ status: { $in: ['Available', 'Sold'] } }, '_id name type breed age price tags status');
    res.json(livestock);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/livestock/:id', async (req, res) => {
  try {
    const livestockItem = await Livestock.findById(req.params.id, '_id name type breed age price tags status');
    if (!livestockItem) return res.status(404).json({ message: "Not found" });
    res.json(livestockItem);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/livestock/image/:id', async (req, res) => {
  try {
    const livestock = await Livestock.findById(req.params.id, 'image');
    if (!livestock?.image?.data) return res.status(404).send('Image not found');
    res.set('Content-Type', livestock.image.contentType);
    res.send(livestock.image.data);
  } catch (err) {
    res.status(500).send('Server error');
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

app.post('/api/orders', authMiddleware, async (req, res) => {
  try {
    // 1. Create Order
    const newOrder = new Order({
      ...req.body,
      userId: req.user.id,
      customer: req.user.name,
    });
    await newOrder.save();
    
    // 2. Clear Cart
    await User.findByIdAndUpdate(req.user.id, { $set: { cart: [] } });

    // 3. FIX: Mark Livestock Items as SOLD
    const itemIds = req.body.items.map(item => item._id || item.id);
    if (itemIds.length > 0) {
        await Livestock.updateMany(
            { _id: { $in: itemIds } },
            { $set: { status: 'Sold' } }
        );
    }

    res.status(201).json(newOrder);
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/orders/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (String(order.userId) !== req.user.id) return res.status(403).json({ message: "Unauthorized" });
    if (order.status !== "Processing") return res.status(400).json({ message: "Only processing orders can be cancelled" });

    // 1. Update Order Status
    order.status = "Cancelled";
    await order.save();

    // 2. FIX: Revert Livestock Items to AVAILABLE
    const itemIds = order.items.map(item => item.id || item._id);
    if (itemIds.length > 0) {
        await Livestock.updateMany(
            { _id: { $in: itemIds } },
            { $set: { status: 'Available' } }
        );
    }

    res.json(order);
  } catch (err) {
    console.error('Cancel order error:', err);
    res.status(500).json({ message: 'Cancel failed' });
  }
});

app.get('/api/user/state', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id, 'cart wishlist addresses');
    res.json({
        cart: user.cart || [],
        wishlist: user.wishlist || [],
        addresses: user.addresses || []
    });
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

// Payment simulation
app.post('/api/payment/create', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    const paymentId = 'PAY_' + Date.now();
    const receiverUpi = process.env.RECEIVER_UPI || 'sai.kambala@ybl';
    const receiverName = process.env.RECEIVER_NAME || 'Kambala Satya Sai Venkatakonda';
    const upiString = `upi://pay?pa=${encodeURIComponent(receiverUpi)}&pn=${encodeURIComponent(receiverName)}&mc=0000&tid=${paymentId}&tr=${paymentId}&am=${amount}`;
    res.json({ upiString, paymentId });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create payment' });
  }
});

app.post('/api/payment/confirm', authMiddleware, async (req, res) => {
    // In real world, verify with provider
    return res.json({ success: true });
});

const PUBLIC_DIR = path.join(__dirname, 'public');
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

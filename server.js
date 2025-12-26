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

// --- Global MongoDB Connection Cache for Serverless ---
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
        throw err;
    }
};

// Call on every invocation (cached)
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
app.use(express.static('public')); // Serves static files (index.html, admin.html, etc.)

// ... [All your existing routes remain unchanged] ...

// Fix typo in livestock image route
app.get('/api/livestock/image/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).send('Invalid ID');
        }
        const livestock = await Livestock.findById(req.params.id);
        if (!livestock || !livestock.image || !livestock.image.data) {
            return res.status(404).send('Image not found');
        }
        res.set('Content-Type', livestock.image.contentType);
        res.send(livestock.image.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    const dbStatus = mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected';
    res.status(200).json({ status: 'UP', database: dbStatus });
});

// Fallback for SPA-like routing (optional, but helps)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- NO app.listen() --- Export for Vercel serverless
module.exports = app;

const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    customer: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true }, // Keeping string for simplicity matching frontend
    items: [{
        _id: String, // Changed from id to _id to match frontend handling
        name: String,
        price: Number,
        breed: String,
        weight: String // Added to ensure weight persists in order details
    }],
    total: { type: Number, required: true },
    status: { type: String, default: 'Processing' }, // Processing, Shipped, Delivered
    address: {
        name: String,
        phone: String,
        line1: String,
        line2: String,
        city: String,
        state: String,
        pincode: String
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);

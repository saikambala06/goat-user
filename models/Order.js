const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    customer: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    items: [{
        _id: String,
        name: String,
        price: Number,
        breed: String,
        type: String,
        weight: String
    }],
    total: { type: Number, required: true },
    status: { type: String, default: 'Processing' },
    // FIXED: Updated address schema to match User.js
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

const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    customer: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true }, // Keeping string for simplicity matching frontend
    items: [{
        id: String,
        name: String,
        price: Number,
        breed: String
    }],
    total: { type: Number, required: true },
    status: { type: String, default: 'Processing' }, // Processing, Shipped, Delivered
    address: {
        name: String,
        phone: String,
        line: String,
        city: String,
        state: String,
        pincode: String
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);


const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    customer: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true }, 
    items: [{
        id: String,
        name: String,
        price: Number,
        breed: String,
        type: String // Added TYPE here to persist (Goat/Sheep)
    }],
    total: { type: Number, required: true },
    status: { type: String, default: 'Processing' }, // Processing, Shipped, Delivered, Cancelled
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

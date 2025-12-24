const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Schema for items inside the user's cart
// Using { _id: false } on schema options, but defining _id field explicitly to store the Product ID.
const cartItemSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // Stores the Livestock ID
  name: { type: String, required: true },
  price: { type: Number, required: true },
  breed: { type: String },
  type: { type: String },
  weight: { type: String },
  selected: { type: Boolean, default: true },
}, { _id: false });

const addressSchema = new mongoose.Schema({
  label: { type: String, default: '' },
  name: { type: String, required: true },
  line1: { type: String, required: true },
  line2: { type: String }, // Made optional
  city: { type: String, required: true },
  state: { type: String, required: true },
  pincode: { type: String, required: true },
  phone: { type: String, required: true },
}, { _id: false });

// Notification Schema for MongoDB Persistence
const notificationSchema = new mongoose.Schema({
  id: String,
  title: String,
  message: String,
  icon: String,
  color: String,
  timestamp: { type: Number, default: Date.now },
  seen: { type: Boolean, default: false } // ADDED: Track if notification is seen
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  // User State Arrays
  cart: [cartItemSchema],
  wishlist: [{ type: String }], // Array of Livestock IDs
  addresses: [addressSchema],
  notifications: [notificationSchema],
  createdAt: { type: Date, default: Date.now },
});

// Password hashing
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next()

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ======================================================================
// DENORMALIZED SCHEMA STRUCTURE
// ======================================================================

// 1. Cart Item Schema
const cartItemSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, 
    name: { type: String, required: true },
    price: { type: Number, required: true },
    breed: { type: String },
    type: { type: String }, 
    selected: { type: Boolean, default: true },
  },
  { _id: false }
);

// 2. Address Schema
const addressSchema = new mongoose.Schema(
  {
    label: { type: String, default: '' },
    name: { type: String, required: true },
    line1: { type: String, required: true },
    line2: { type: String, default: '' },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    phone: { type: String, required: true },
  },
  { _id: false }
);

// 3. User Main Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  
  // Storage for persistent user state:
  cart: [cartItemSchema], 
  // FIX: Changed to a simple array of Strings to correctly store IDs
  wishlist: [String],
  addresses: [addressSchema],
  
  createdAt: { type: Date, default: Date.now },
});

// ======================================================================
// BCRYPT HASHING LOGIC
// ======================================================================

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

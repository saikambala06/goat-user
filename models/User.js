const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
// ======================================================================
// DENORMALIZED SCHEMA STRUCTURE (Matches Client-side State Persistence)
// ======================================================================
// 1. Cart Item Schema
const cartItemSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, 
    name: { type: String, required: true },
    price: { type: Number, required: true },
    breed: { type: String },
    type: { type: String }, 
    weight: { type: String }, 
    selected: { type: Boolean, default: true },
  },
  { _id: false } 
);
// ... rest of your code (Address Schema, User Schema, etc.) remains the same
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
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  cart: [cartItemSchema], 
  wishlist: [
    {
      type: String, 
    },
  ],
  addresses: [addressSchema],
  createdAt: { type: Date, default: Date.now },
});
// ... (Keep existing password hashing logic below) ...
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

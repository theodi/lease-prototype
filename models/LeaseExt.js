import mongoose from 'mongoose';

const leaseExtSchema = new mongoose.Schema({
  lid: { type: mongoose.Schema.Types.ObjectId, ref: 'Lease', index: true },
  st: Date,
  exp: Date,
  ty: Number
}, {
  timestamps: true,
  collection: 'leasesext',
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

leaseExtSchema.virtual('Start Date').get(function () {
  if (!this.st) return null;
  const d = new Date(this.st);
  return d.toISOString().split('T')[0]; // Format as 'YYYY-MM-DD'
});
leaseExtSchema.virtual('Expiry Date').get(function () {
  if (!this.exp) return null;
  const d = new Date(this.exp);
  return d.toISOString().split('T')[0]; // Returns YYYY-MM-DD
});
leaseExtSchema.virtual('Tenure Years').get(function () {
  return this.ty;
});

// Static method to remap keys using virtual aliases
leaseExtSchema.statics.remapLeases = function (leases) {
  const formatDate = (d) => {
    if (!d) return null;
    const date = new Date(d);
    return date.toISOString().split('T')[0];
  };

  const mapOne = lease => ({
    '_id': lease._id,
    'lease_id': lease.lid,
    'Start Date': formatDate(lease.st),
    'Expiry Date': formatDate(lease.exp),
    'Tenure Years': lease.ty
  });

  if (Array.isArray(leases)) return leases.map(mapOne);
  return mapOne(leases);
};

const LeaseExt = mongoose.model('LeaseExt', leaseExtSchema);

export default LeaseExt;

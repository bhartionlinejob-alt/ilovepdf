const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
    siteName: {
        type: String,
        default: 'PDF Tools'
    },
    siteLogo: {
        type: String,
        default: '/assets/default-logo.png'
    },
    favicon: {
        type: String,
        default: ''
    },
    primaryColor: {
        type: String,
        default: '#e74c3c'
    },
    secondaryColor: {
        type: String,
        default: '#c0392b'
    },
    theme: {
        type: String,
        enum: ['light', 'dark', 'custom'],
        default: 'light'
    },
    customCSS: {
        type: String,
        default: ''
    },
    customJS: {
        type: String,
        default: ''
    },
    adsenseEnabled: {
        type: Boolean,
        default: false
    },
    adsenseCode: {
        type: String,
        default: ''
    },
    analyticsCode: {
        type: String,
        default: ''
    },
    footerText: {
        type: String,
        default: '© 2024 PDF Tools. All files are automatically deleted after 1 hour.'
    },
    maxFileSize: {
        type: Number,
        default: 50
    },
    enableWatermark: {
        type: Boolean,
        default: true
    },
    watermarkText: {
        type: String,
        default: 'WATERMARK'
    },
    adminUser: {
        username: { type: String, default: 'admin' },
        password: { type: String }
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Setting', settingSchema);

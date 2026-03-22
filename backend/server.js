
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs-extra');

const pdfRoutes = require('./routes/pdf');
const adminRoutes = require('./routes/admin');
const Setting = require('./models/Setting');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pdf-tools';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000
}).then(() => {
    console.log('Connected to MongoDB');
    initializeSettings();
}).catch(err => {
    console.error('MongoDB connection error:', err);
    console.log('Continuing without database...');
});

// Initialize default settings
async function initializeSettings() {
    try {
        const settings = await Setting.findOne();
        if (!settings) {
            const defaultSettings = new Setting({
                siteName: 'PDF Tools',
                siteLogo: '/assets/default-logo.png',
                primaryColor: '#e74c3c',
                secondaryColor: '#c0392b',
                theme: 'light',
                adsenseEnabled: false,
                adsenseCode: '',
                customCSS: '',
                customJS: '',
                analyticsCode: '',
                footerText: '© 2024 PDF Tools. All files are automatically deleted after 1 hour.',
                maxFileSize: 50,
                enableWatermark: true,
                watermarkText: 'WATERMARK'
            });
            await defaultSettings.save();
            console.log('Default settings initialized');
        }
    } catch (error) {
        console.error('Settings initialization error:', error);
    }
}

// Middleware
app.use(helmet({
    contentSecurityPolicy: false
}));
app.use(compression());
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from frontend
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/assets', express.static(path.join(__dirname, '../frontend/assets')));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
fs.ensureDirSync(uploadDir);

// Routes
app.use('/api/pdf', pdfRoutes);
app.use('/api/admin', adminRoutes);

// Get site settings for frontend
app.get('/api/settings', async (req, res) => {
    try {
        const settings = await Setting.findOne();
        res.json(settings || {});
    } catch (error) {
        console.error('Settings fetch error:', error);
        res.json({
            siteName: 'PDF Tools',
            primaryColor: '#e74c3c',
            secondaryColor: '#c0392b',
            theme: 'light'
        });
    }
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

// Handle SPA routing - serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Clean up old files every hour
setInterval(async () => {
    try {
        const files = await fs.readdir(uploadDir);
        const now = Date.now();
        for (const file of files) {
            if (file === '.gitkeep') continue;
            const filePath = path.join(uploadDir, file);
            const stats = await fs.stat(filePath);
            if (now - stats.mtimeMs > 3600000) {
                await fs.unlink(filePath);
                console.log(`Deleted old file: ${file}`);
            }
        }
    } catch (error) {
        console.error('Cleanup error:', error);
    }
}, 3600000);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        success: false, 
        error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message 
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

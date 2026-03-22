const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const Setting = require('../models/Setting');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Admin authentication middleware
const authenticateAdmin = async (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        const settings = await Setting.findOne();
        if (decoded.username === settings.adminUser?.username) {
            req.admin = decoded;
            next();
        } else {
            res.status(401).json({ error: 'Unauthorized' });
        }
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Configure multer for logo upload (using memory storage)
const logoStorage = multer.memoryStorage();
const uploadLogo = multer({ 
    storage: logoStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        let settings = await Setting.findOne();
        
        if (!settings) {
            settings = new Setting();
            await settings.save();
        }
        
        if (!settings.adminUser?.password) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            settings.adminUser = { username: 'admin', password: hashedPassword };
            await settings.save();
        }
        
        if (username === settings.adminUser.username) {
            const isValid = await bcrypt.compare(password, settings.adminUser.password);
            if (isValid) {
                const token = jwt.sign({ username }, process.env.JWT_SECRET || 'secret', { expiresIn: '24h' });
                res.json({ success: true, token });
            } else {
                res.status(401).json({ error: 'Invalid credentials' });
            }
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get settings
router.get('/settings', authenticateAdmin, async (req, res) => {
    try {
        const settings = await Setting.findOne();
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update settings
router.put('/settings', authenticateAdmin, async (req, res) => {
    try {
        const settings = await Setting.findOneAndUpdate(
            {},
            req.body,
            { new: true, upsert: true }
        );
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Upload logo (using memory storage - no disk writes)
router.post('/upload-logo', authenticateAdmin, uploadLogo.single('logo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        // Convert image to base64 for storage
        const base64Logo = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        
        // Store base64 image in database
        await Setting.findOneAndUpdate({}, { siteLogo: base64Logo });
        
        res.json({ success: true, logoUrl: base64Logo });
    } catch (error) {
        console.error('Logo upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Change password
router.post('/change-password', authenticateAdmin, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const settings = await Setting.findOne();
        
        const isValid = await bcrypt.compare(currentPassword, settings.adminUser.password);
        if (!isValid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        settings.adminUser.password = hashedPassword;
        await settings.save();
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

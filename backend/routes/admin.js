const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
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

// Upload logo
router.post('/upload-logo', authenticateAdmin, multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const uploadPath = path.join(__dirname, '../../frontend/assets');
            fs.ensureDirSync(uploadPath);
            cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
            cb(null, `logo-${Date.now()}${path.extname(file.originalname)}`);
        }
    })
}).single('logo'), async (req, res) => {
    try {
        const logoUrl = `/assets/${req.file.filename}`;
        await Setting.findOneAndUpdate({}, { siteLogo: logoUrl });
        res.json({ success: true, logoUrl });
    } catch (error) {
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

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');
const Setting = require('../models/Setting');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../uploads');
        fs.ensureDirSync(uploadPath);
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['application/pdf'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'));
        }
    }
});

// Merge PDFs
router.post('/merge', upload.array('pdfs', 10), async (req, res) => {
    try {
        const mergedPdf = await PDFDocument.create();
        
        for (const file of req.files) {
            const pdfBytes = await fs.readFile(file.path);
            const pdf = await PDFDocument.load(pdfBytes);
            const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            pages.forEach(page => mergedPdf.addPage(page));
        }
        
        const mergedPdfBytes = await mergedPdf.save();
        const outputPath = path.join(__dirname, '../uploads', `merged-${uuidv4()}.pdf`);
        await fs.writeFile(outputPath, mergedPdfBytes);
        
        res.json({
            success: true,
            downloadUrl: `/api/pdf/download/${path.basename(outputPath)}`
        });
    } catch (error) {
        console.error('Merge error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Split PDF
router.post('/split', upload.single('file'), async (req, res) => {
    try {
        const pdfBytes = await fs.readFile(req.file.path);
        const pdf = await PDFDocument.load(pdfBytes);
        const pageCount = pdf.getPageCount();
        
        const splitFiles = [];
        for (let i = 0; i < pageCount; i++) {
            const newPdf = await PDFDocument.create();
            const [page] = await newPdf.copyPages(pdf, [i]);
            newPdf.addPage(page);
            const newPdfBytes = await newPdf.save();
            
            const outputPath = path.join(__dirname, '../uploads', `page-${i + 1}-${uuidv4()}.pdf`);
            await fs.writeFile(outputPath, newPdfBytes);
            splitFiles.push({
                page: i + 1,
                downloadUrl: `/api/pdf/download/${path.basename(outputPath)}`
            });
        }
        
        res.json({
            success: true,
            files: splitFiles
        });
    } catch (error) {
        console.error('Split error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Compress PDF
router.post('/compress', upload.single('file'), async (req, res) => {
    try {
        const pdfBytes = await fs.readFile(req.file.path);
        const pdf = await PDFDocument.load(pdfBytes);
        
        const compressedBytes = await pdf.save({
            useObjectStreams: true,
            addDefaultPage: false,
            objectsPerTick: 50
        });
        
        const outputPath = path.join(__dirname, '../uploads', `compressed-${uuidv4()}.pdf`);
        await fs.writeFile(outputPath, compressedBytes);
        
        res.json({
            success: true,
            downloadUrl: `/api/pdf/download/${path.basename(outputPath)}`,
            originalSize: req.file.size,
            compressedSize: compressedBytes.length
        });
    } catch (error) {
        console.error('Compress error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Rotate PDF
router.post('/rotate', upload.single('file'), async (req, res) => {
    try {
        const { angle } = req.body;
        const pdfBytes = await fs.readFile(req.file.path);
        const pdf = await PDFDocument.load(pdfBytes);
        const pages = pdf.getPages();
        
        pages.forEach(page => {
            page.setRotation(page.getRotation().angle + parseInt(angle));
        });
        
        const rotatedPdfBytes = await pdf.save();
        const outputPath = path.join(__dirname, '../uploads', `rotated-${uuidv4()}.pdf`);
        await fs.writeFile(outputPath, rotatedPdfBytes);
        
        res.json({
            success: true,
            downloadUrl: `/api/pdf/download/${path.basename(outputPath)}`
        });
    } catch (error) {
        console.error('Rotate error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add Watermark
router.post('/watermark', upload.single('file'), async (req, res) => {
    try {
        const settings = await Setting.findOne();
        const { text } = req.body;
        const watermarkText = text || settings?.watermarkText || 'WATERMARK';
        
        const pdfBytes = await fs.readFile(req.file.path);
        const pdf = await PDFDocument.load(pdfBytes);
        const pages = pdf.getPages();
        
        for (const page of pages) {
            const { width, height } = page.getSize();
            const font = await pdf.embedFont(StandardFonts.Helvetica);
            const fontSize = 60;
            const textWidth = font.widthOfTextAtSize(watermarkText, fontSize);
            
            page.drawText(watermarkText, {
                x: (width - textWidth) / 2,
                y: height / 2,
                size: fontSize,
                font: font,
                color: rgb(0.5, 0.5, 0.5),
                opacity: 0.3
            });
        }
        
        const watermarkedPdfBytes = await pdf.save();
        const outputPath = path.join(__dirname, '../uploads', `watermarked-${uuidv4()}.pdf`);
        await fs.writeFile(outputPath, watermarkedPdfBytes);
        
        res.json({
            success: true,
            downloadUrl: `/api/pdf/download/${path.basename(outputPath)}`
        });
    } catch (error) {
        console.error('Watermark error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Protect PDF with password
router.post('/protect', upload.single('file'), async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }
        
        const pdfBytes = await fs.readFile(req.file.path);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        
        pdfDoc.encrypt({
            userPassword: password,
            ownerPassword: password,
            permissions: {
                printing: 'highResolution',
                modifying: false,
                copying: false,
                annotating: false,
                fillingForms: false,
                contentAccessibility: true,
                documentAssembly: false
            }
        });
        
        const protectedPdfBytes = await pdfDoc.save();
        const outputPath = path.join(__dirname, '../uploads', `protected-${uuidv4()}.pdf`);
        await fs.writeFile(outputPath, protectedPdfBytes);
        
        res.json({
            success: true,
            downloadUrl: `/api/pdf/download/${path.basename(outputPath)}`
        });
    } catch (error) {
        console.error('Protect error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Download file
router.get('/download/:filename', (req, res) => {
    const filepath = path.join(__dirname, '../uploads', req.params.filename);
    if (fs.existsSync(filepath)) {
        res.download(filepath);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

module.exports = router;

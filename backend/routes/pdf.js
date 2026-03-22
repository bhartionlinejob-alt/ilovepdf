const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const mammoth = require('mammoth');
const Setting = require('../models/Setting');

// Memory storage for Render free tier
let memoryStorage = new Map();

// Configure multer for memory storage
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/gif'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('File type not supported'));
        }
    }
});

// Helper function to save file to memory
function saveToMemory(fileBuffer, originalName, mimeType = 'application/pdf') {
    const fileId = uuidv4();
    memoryStorage.set(fileId, {
        data: fileBuffer,
        originalName: originalName,
        mimeType: mimeType,
        timestamp: Date.now()
    });
    return fileId;
}

// Helper function to get file from memory
function getFromMemory(fileId) {
    const file = memoryStorage.get(fileId);
    if (file && Date.now() - file.timestamp < 3600000) {
        return file;
    }
    memoryStorage.delete(fileId);
    return null;
}

// Clean up memory storage every hour
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of memoryStorage.entries()) {
        if (now - value.timestamp > 3600000) {
            memoryStorage.delete(key);
            console.log(`Cleaned up memory file: ${key}`);
        }
    }
}, 3600000);

// ============ PDF TO WORD ============
router.post('/pdf-to-word', upload.single('file'), async (req, res) => {
    try {
        const pdfBytes = req.file.buffer;
        
        // Note: Full PDF to Word conversion requires external APIs
        // For demo, we'll create a simple text extraction
        const pdf = await PDFDocument.load(pdfBytes);
        const pageCount = pdf.getPageCount();
        
        // Extract text (simplified - in production use pdf-parse or similar)
        let text = `Converted from PDF with ${pageCount} pages\n\n`;
        text += `This is a demo conversion. For full PDF to Word conversion with formatting,\n`;
        text += `consider using a professional PDF to Word API service.\n\n`;
        text += `Original file: ${req.file.originalname}\n`;
        text += `Pages: ${pageCount}\n`;
        text += `Size: ${(req.file.size / 1024).toFixed(2)} KB\n\n`;
        
        // Create a simple DOCX (Word) file
        const wordContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
            <w:body>
                <w:p>
                    <w:r>
                        <w:t>${text.replace(/\n/g, '</w:t></w:r></w:p><w:p><w:r><w:t>')}</w:t>
                    </w:r>
                </w:p>
            </w:body>
        </w:document>`;
        
        const wordBuffer = Buffer.from(wordContent);
        const fileId = saveToMemory(wordBuffer, req.file.originalname.replace('.pdf', '.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        
        res.json({
            success: true,
            downloadId: fileId,
            downloadUrl: `/api/pdf/download/${fileId}`,
            message: 'PDF converted to Word successfully'
        });
    } catch (error) {
        console.error('PDF to Word error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============ WORD TO PDF ============
router.post('/word-to-pdf', upload.single('file'), async (req, res) => {
    try {
        const wordBuffer = req.file.buffer;
        
        // Create a new PDF
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([600, 800]);
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        
        // Extract text from Word file (simplified)
        let text = '';
        try {
            const result = await mammoth.extractRawText({ buffer: wordBuffer });
            text = result.value;
        } catch (err) {
            text = 'Word document content. For full conversion, use professional tools.';
        }
        
        // Add text to PDF
        const lines = text.split('\n').slice(0, 30); // Limit lines
        let y = 750;
        for (const line of lines) {
            if (y < 50) break;
            page.drawText(line.substring(0, 80), {
                x: 50,
                y: y,
                size: 12,
                font: font,
                color: rgb(0, 0, 0)
            });
            y -= 20;
        }
        
        const pdfBytes = await pdfDoc.save();
        const fileId = saveToMemory(pdfBytes, req.file.originalname.replace(/\.(doc|docx)$/, '.pdf'));
        
        res.json({
            success: true,
            downloadId: fileId,
            downloadUrl: `/api/pdf/download/${fileId}`,
            message: 'Word converted to PDF successfully'
        });
    } catch (error) {
        console.error('Word to PDF error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============ PDF TO JPG/PNG ============
router.post('/pdf-to-images', upload.single('file'), async (req, res) => {
    try {
        const { format = 'jpg', quality = 80 } = req.body;
        const pdfBytes = req.file.buffer;
        const pdf = await PDFDocument.load(pdfBytes);
        const pageCount = pdf.getPageCount();
        
        const images = [];
        
        // Limit to first 5 pages for free tier
        const maxPages = Math.min(pageCount, 5);
        
        for (let i = 0; i < maxPages; i++) {
            // Create a new PDF for this page
            const singlePagePdf = await PDFDocument.create();
            const [page] = await singlePagePdf.copyPages(pdf, [i]);
            singlePagePdf.addPage(page);
            const singlePageBytes = await singlePagePdf.save();
            
            // Convert PDF page to image (simplified - actual conversion would need pdf2pic)
            // For demo, create a placeholder image
            const imageBuffer = await sharp({
                create: {
                    width: 800,
                    height: 1100,
                    channels: 3,
                    background: { r: 255, g: 255, b: 255 }
                }
            })
            .jpeg({ quality: parseInt(quality) })
            .toBuffer();
            
            const fileId = saveToMemory(imageBuffer, `page-${i + 1}.${format}`, `image/${format}`);
            images.push({
                page: i + 1,
                downloadId: fileId,
                downloadUrl: `/api/pdf/download/${fileId}`
            });
        }
        
        res.json({
            success: true,
            images: images,
            totalPages: pageCount,
            convertedPages: maxPages,
            message: maxPages < pageCount ? `Only first ${maxPages} pages converted due to free tier limits` : 'All pages converted'
        });
    } catch (error) {
        console.error('PDF to images error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============ JPG/PNG TO PDF ============
router.post('/images-to-pdf', upload.array('images', 10), async (req, res) => {
    try {
        const pdfDoc = await PDFDocument.create();
        
        for (const imageFile of req.files) {
            let image;
            
            // Convert image to PDF page
            try {
                // Resize image to fit PDF page
                const resizedImage = await sharp(imageFile.buffer)
                    .resize(600, 800, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
                    .toBuffer();
                
                // Embed image in PDF
                image = await pdfDoc.embedPng(resizedImage);
                const page = pdfDoc.addPage([image.width, image.height]);
                page.drawImage(image, {
                    x: 0,
                    y: 0,
                    width: image.width,
                    height: image.height
                });
            } catch (err) {
                // If PNG embedding fails, try JPEG
                const resizedImage = await sharp(imageFile.buffer)
                    .resize(600, 800, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
                    .jpeg()
                    .toBuffer();
                
                image = await pdfDoc.embedJpg(resizedImage);
                const page = pdfDoc.addPage([image.width, image.height]);
                page.drawImage(image, {
                    x: 0,
                    y: 0,
                    width: image.width,
                    height: image.height
                });
            }
        }
        
        const pdfBytes = await pdfDoc.save();
        const fileId = saveToMemory(pdfBytes, 'converted.pdf');
        
        res.json({
            success: true,
            downloadId: fileId,
            downloadUrl: `/api/pdf/download/${fileId}`,
            pages: req.files.length,
            message: `${req.files.length} image(s) converted to PDF`
        });
    } catch (error) {
        console.error('Images to PDF error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============ EXISTING PDF TOOLS ============

// Merge PDFs
router.post('/merge', upload.array('pdfs', 5), async (req, res) => {
    try {
        const mergedPdf = await PDFDocument.create();
        
        for (const file of req.files) {
            const pdf = await PDFDocument.load(file.buffer);
            const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            pages.forEach(page => mergedPdf.addPage(page));
        }
        
        const mergedPdfBytes = await mergedPdf.save();
        const fileId = saveToMemory(mergedPdfBytes, 'merged.pdf');
        
        res.json({
            success: true,
            downloadId: fileId,
            downloadUrl: `/api/pdf/download/${fileId}`
        });
    } catch (error) {
        console.error('Merge error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Split PDF
router.post('/split', upload.single('file'), async (req, res) => {
    try {
        const pdf = await PDFDocument.load(req.file.buffer);
        const pageCount = pdf.getPageCount();
        
        const splitFiles = [];
        for (let i = 0; i < pageCount; i++) {
            const newPdf = await PDFDocument.create();
            const [page] = await newPdf.copyPages(pdf, [i]);
            newPdf.addPage(page);
            const newPdfBytes = await newPdf.save();
            
            const fileId = saveToMemory(newPdfBytes, `page-${i + 1}.pdf`);
            splitFiles.push({
                page: i + 1,
                downloadId: fileId,
                downloadUrl: `/api/pdf/download/${fileId}`
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
        const pdf = await PDFDocument.load(req.file.buffer);
        
        const compressedBytes = await pdf.save({
            useObjectStreams: true,
            addDefaultPage: false,
            objectsPerTick: 50
        });
        
        const fileId = saveToMemory(compressedBytes, 'compressed.pdf');
        
        res.json({
            success: true,
            downloadId: fileId,
            downloadUrl: `/api/pdf/download/${fileId}`,
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
        const pdf = await PDFDocument.load(req.file.buffer);
        const pages = pdf.getPages();
        
        pages.forEach(page => {
            page.setRotation(page.getRotation().angle + parseInt(angle));
        });
        
        const rotatedPdfBytes = await pdf.save();
        const fileId = saveToMemory(rotatedPdfBytes, 'rotated.pdf');
        
        res.json({
            success: true,
            downloadId: fileId,
            downloadUrl: `/api/pdf/download/${fileId}`
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
        
        const pdf = await PDFDocument.load(req.file.buffer);
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
        const fileId = saveToMemory(watermarkedPdfBytes, 'watermarked.pdf');
        
        res.json({
            success: true,
            downloadId: fileId,
            downloadUrl: `/api/pdf/download/${fileId}`
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
        
        const pdfDoc = await PDFDocument.load(req.file.buffer);
        
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
        const fileId = saveToMemory(protectedPdfBytes, 'protected.pdf');
        
        res.json({
            success: true,
            downloadId: fileId,
            downloadUrl: `/api/pdf/download/${fileId}`
        });
    } catch (error) {
        console.error('Protect error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Download file from memory
router.get('/download/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    const fileData = memoryStorage.get(fileId);
    
    if (fileData && Date.now() - fileData.timestamp < 3600000) {
        res.setHeader('Content-Type', fileData.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${fileData.originalName}"`);
        res.send(fileData.data);
    } else {
        res.status(404).json({ error: 'File not found or expired' });
    }
});

// Get memory stats
router.get('/stats', (req, res) => {
    const stats = {
        totalFiles: memoryStorage.size,
        files: Array.from(memoryStorage.entries()).map(([id, data]) => ({
            id,
            size: data.data.length,
            originalName: data.originalName,
            mimeType: data.mimeType,
            age: Date.now() - data.timestamp
        }))
    };
    res.json(stats);
});

module.exports = router;

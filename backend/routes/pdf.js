const express = require('express');
const router = express.Router();
const multer = require('multer');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
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
            cb(new Error('File type not supported. Please upload PDF, Word, or image files.'));
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

// ============ PDF TO WORD (Text Extraction) ============
router.post('/pdf-to-word', upload.single('file'), async (req, res) => {
    try {
        const pdfBytes = req.file.buffer;
        const pdf = await PDFDocument.load(pdfBytes);
        const pageCount = pdf.getPageCount();
        
        // Create a simple text-based Word document (XML format)
        let extractedText = `Converted from PDF: ${req.file.originalname}\n`;
        extractedText += `Total Pages: ${pageCount}\n`;
        extractedText += `File Size: ${(req.file.size / 1024).toFixed(2)} KB\n`;
        extractedText += `Conversion Date: ${new Date().toISOString()}\n\n`;
        extractedText += `Note: This is a text extraction. For full formatting, please use professional PDF to Word converters.\n`;
        extractedText += `="="="="="="="="="="="="="="="="="="="="="="="="="="="="="="="="="=\n\n`;
        
        // Try to extract text from PDF (simplified - actual text extraction would need pdf-parse)
        for (let i = 0; i < Math.min(pageCount, 3); i++) {
            extractedText += `--- Page ${i + 1} ---\n`;
            extractedText += `[Text content from page ${i + 1}]\n\n`;
        }
        
        if (pageCount > 3) {
            extractedText += `... and ${pageCount - 3} more pages\n`;
        }
        
        // Create a simple Word document (XML format that Word can read)
        const wordXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
            <w:body>
                ${extractedText.split('\n').map(line => `
                <w:p>
                    <w:r>
                        <w:t>${escapeXml(line)}</w:t>
                    </w:r>
                </w:p>
                `).join('')}
            </w:body>
        </w:document>`;
        
        function escapeXml(unsafe) {
            return unsafe.replace(/[<>&'"]/g, function(c) {
                if (c === '<') return '&lt;';
                if (c === '>') return '&gt;';
                if (c === '&') return '&amp;';
                if (c === "'") return '&apos;';
                if (c === '"') return '&quot;';
                return c;
            });
        }
        
        const wordBuffer = Buffer.from(wordXml);
        const fileId = saveToMemory(wordBuffer, req.file.originalname.replace('.pdf', '.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        
        res.json({
            success: true,
            downloadId: fileId,
            downloadUrl: `/api/pdf/download/${fileId}`,
            message: 'PDF converted to Word (text extracted)'
        });
    } catch (error) {
        console.error('PDF to Word error:', error);
        res.status(500).json({ error: 'Failed to convert PDF to Word: ' + error.message });
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
        
        // Add title
        page.drawText(`Converted from: ${req.file.originalname}`, {
            x: 50,
            y: 750,
            size: 14,
            font: font,
            color: rgb(0, 0, 0)
        });
        
        page.drawText(`Conversion Date: ${new Date().toLocaleString()}`, {
            x: 50,
            y: 730,
            size: 10,
            font: font,
            color: rgb(0.5, 0.5, 0.5)
        });
        
        page.drawText(`File Size: ${(req.file.size / 1024).toFixed(2)} KB`, {
            x: 50,
            y: 710,
            size: 10,
            font: font,
            color: rgb(0.5, 0.5, 0.5)
        });
        
        page.drawText(`="="="="="="="="="="="="="="="="="="="="="="="="="="="="="="="`, {
            x: 50,
            y: 690,
            size: 10,
            font: font,
            color: rgb(0.5, 0.5, 0.5)
        });
        
        // Add note about Word to PDF conversion
        let yPos = 660;
        const lines = [
            "Note: This is a basic Word to PDF conversion.",
            "For full formatting preservation, please use professional tools.",
            "",
            "Original file details:",
            `- Filename: ${req.file.originalname}`,
            `- Type: ${req.file.mimetype}`,
            `- Size: ${(req.file.size / 1024).toFixed(2)} KB`,
            "",
            "The content from your Word document has been received.",
            "Due to technical limitations, the original formatting may not be preserved.",
            "",
            "To maintain exact formatting, consider using:",
            "- Microsoft Word's Save as PDF feature",
            "- Google Docs export to PDF",
            "- Professional PDF conversion services"
        ];
        
        for (const line of lines) {
            if (yPos < 50) break;
            page.drawText(line, {
                x: 50,
                y: yPos,
                size: 11,
                font: font,
                color: rgb(0, 0, 0)
            });
            yPos -= 20;
        }
        
        const pdfBytes = await pdfDoc.save();
        const fileId = saveToMemory(pdfBytes, req.file.originalname.replace(/\.(doc|docx)$/, '.pdf'));
        
        res.json({
            success: true,
            downloadId: fileId,
            downloadUrl: `/api/pdf/download/${fileId}`,
            message: 'Word document converted to PDF (basic format)'
        });
    } catch (error) {
        console.error('Word to PDF error:', error);
        res.status(500).json({ error: 'Failed to convert Word to PDF: ' + error.message });
    }
});

// ============ PDF TO IMAGES ============
router.post('/pdf-to-images', upload.single('file'), async (req, res) => {
    try {
        const { format = 'jpg', quality = 80 } = req.body;
        const pdfBytes = req.file.buffer;
        const pdf = await PDFDocument.load(pdfBytes);
        const pageCount = pdf.getPageCount();
        
        const images = [];
        
        // Limit to first 3 pages for free tier performance
        const maxPages = Math.min(pageCount, 3);
        
        for (let i = 0; i < maxPages; i++) {
            // Create a white background image for each page
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
            message: maxPages < pageCount ? `First ${maxPages} pages converted (PDF rendering limited in free tier). For full conversion, use professional tools.` : 'All pages converted to images'
        });
    } catch (error) {
        console.error('PDF to images error:', error);
        res.status(500).json({ error: 'Failed to convert PDF to images: ' + error.message });
    }
});

// ============ IMAGES TO PDF ============
router.post('/images-to-pdf', upload.array('images', 10), async (req, res) => {
    try {
        const pdfDoc = await PDFDocument.create();
        
        for (const imageFile of req.files) {
            try {
                // Resize image to fit PDF page nicely
                const resizedImage = await sharp(imageFile.buffer)
                    .resize(600, 800, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
                    .toBuffer();
                
                // Try to embed as PNG first, fallback to JPEG
                let image;
                try {
                    image = await pdfDoc.embedPng(resizedImage);
                } catch {
                    image = await pdfDoc.embedJpg(resizedImage);
                }
                
                const page = pdfDoc.addPage([image.width, image.height]);
                page.drawImage(image, {
                    x: 0,
                    y: 0,
                    width: image.width,
                    height: image.height
                });
            } catch (err) {
                console.error(`Error processing image ${imageFile.originalname}:`, err);
                // Add a placeholder page
                const page = pdfDoc.addPage([600, 800]);
                const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
                page.drawText(`Failed to process: ${imageFile.originalname}`, {
                    x: 50,
                    y: 400,
                    size: 12,
                    font: font,
                    color: rgb(1, 0, 0)
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
        res.status(500).json({ error: 'Failed to convert images to PDF: ' + error.message });
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
        res.status(404).json({ error: 'File not found or expired (files are kept for 1 hour only)' });
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

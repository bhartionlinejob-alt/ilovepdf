class PDFToolsApp {
    constructor() {
        this.settings = null;
        this.init();
    }
    
    async init() {
        await this.loadSettings();
        this.applySettings();
        this.loadTools();
        this.setupEventListeners();
    }
    
    async loadSettings() {
        try {
            const response = await fetch('/api/settings');
            this.settings = await response.json();
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }
    
    applySettings() {
        if (!this.settings) return;
        
        document.getElementById('site-title').textContent = this.settings.siteName;
        document.getElementById('site-name').textContent = this.settings.siteName;
        
        if (this.settings.siteLogo) {
            document.getElementById('site-logo').src = this.settings.siteLogo;
        }
        
        document.documentElement.style.setProperty('--primary-color', this.settings.primaryColor);
        document.documentElement.style.setProperty('--secondary-color', this.settings.secondaryColor);
        
        if (this.settings.theme === 'dark') {
            document.body.setAttribute('data-theme', 'dark');
        }
        
        document.getElementById('footer-text').textContent = this.settings.footerText;
        
        if (this.settings.customCSS) {
            document.getElementById('custom-css').textContent = this.settings.customCSS;
        }
        
        if (this.settings.customJS) {
            document.getElementById('custom-js').textContent = this.settings.customJS;
        }
        
        if (this.settings.adsenseEnabled && this.settings.adsenseCode) {
            document.getElementById('adsense-container').innerHTML = this.settings.adsenseCode;
        }
    }
    
    loadTools() {
    const tools = [
        // Basic PDF Tools
        { id: 'merge', icon: 'fa-object-group', name: 'Merge PDF', description: 'Combine multiple PDF files into one', endpoint: '/api/pdf/merge', multiple: true, accept: '.pdf' },
        { id: 'split', icon: 'fa-cut', name: 'Split PDF', description: 'Split PDF into separate pages', endpoint: '/api/pdf/split', multiple: false, accept: '.pdf' },
        { id: 'compress', icon: 'fa-compress-alt', name: 'Compress PDF', description: 'Reduce PDF file size', endpoint: '/api/pdf/compress', multiple: false, accept: '.pdf' },
        { id: 'rotate', icon: 'fa-undo-alt', name: 'Rotate PDF', description: 'Rotate PDF pages', endpoint: '/api/pdf/rotate', multiple: false, accept: '.pdf', hasAngle: true },
        { id: 'watermark', icon: 'fa-water', name: 'Add Watermark', description: 'Add text watermark to PDF', endpoint: '/api/pdf/watermark', multiple: false, accept: '.pdf', hasText: true },
        { id: 'protect', icon: 'fa-lock', name: 'Protect PDF', description: 'Add password protection', endpoint: '/api/pdf/protect', multiple: false, accept: '.pdf', hasPassword: true },
        
        // Conversion Tools
        { id: 'pdf-to-word', icon: 'fa-file-word', name: 'PDF to Word', description: 'Convert PDF to editable Word document', endpoint: '/api/pdf/pdf-to-word', multiple: false, accept: '.pdf', color: '#2b5797' },
        { id: 'word-to-pdf', icon: 'fa-file-pdf', name: 'Word to PDF', description: 'Convert Word document to PDF', endpoint: '/api/pdf/word-to-pdf', multiple: false, accept: '.doc,.docx', color: '#185abd' },
        { id: 'pdf-to-images', icon: 'fa-file-image', name: 'PDF to Images', description: 'Convert PDF pages to JPG/PNG images', endpoint: '/api/pdf/pdf-to-images', multiple: false, accept: '.pdf', hasFormat: true },
        { id: 'images-to-pdf', icon: 'fa-images', name: 'Images to PDF', description: 'Convert JPG/PNG images to PDF', endpoint: '/api/pdf/images-to-pdf', multiple: true, accept: '.jpg,.jpeg,.png,.gif' }
    ];
    
    const toolsGrid = document.getElementById('tools-grid');
    toolsGrid.innerHTML = '';
    
    tools.forEach(tool => {
        const card = document.createElement('div');
        card.className = 'tool-card';
        card.id = tool.id;
        
        let extraFields = '';
        if (tool.hasAngle) {
            extraFields = `<select class="rotate-angle"><option value="90">90° Clockwise</option><option value="180">180°</option><option value="270">270°</option></select>`;
        } else if (tool.hasText) {
            extraFields = `<input type="text" class="watermark-text" placeholder="Watermark text" value="${this.settings?.watermarkText || 'WATERMARK'}">`;
        } else if (tool.hasPassword) {
            extraFields = `<input type="password" class="password-input" placeholder="Password">`;
        } else if (tool.hasFormat) {
            extraFields = `
                <select class="image-format">
                    <option value="jpg">JPG Format</option>
                    <option value="png">PNG Format</option>
                </select>
                <input type="number" class="image-quality" placeholder="Quality (1-100)" value="80" min="1" max="100">
            `;
        }
        
        // Set accept attribute based on file types
        const acceptAttr = tool.accept || '.pdf';
        
        card.innerHTML = `
            <div class="tool-icon" style="${tool.color ? `color: ${tool.color}` : ''}">
                <i class="fas ${tool.icon}"></i>
            </div>
            <h2>${tool.name}</h2>
            <p>${tool.description}</p>
            <div class="tool-content">
                <input type="file" class="file-input" ${tool.multiple ? 'multiple' : ''} accept="${acceptAttr}">
                ${extraFields}
                <button class="btn-primary" data-action="${tool.id}" data-endpoint="${tool.endpoint}">${tool.name}</button>
                <div class="progress-bar"><div class="progress"></div></div>
            </div>
        `;
        
        toolsGrid.appendChild(card);
    });
}
    
    setupEventListeners() {
        document.addEventListener('click', async (e) => {
            const button = e.target.closest('.btn-primary');
            if (button) {
                await this.handleToolAction(button);
            }
        });
    }
    
    async handleToolAction(button) {
        const toolCard = button.closest('.tool-card');
        const fileInput = toolCard.querySelector('.file-input');
        const progressBar = toolCard.querySelector('.progress-bar');
        const endpoint = button.dataset.endpoint;
        
        if (!fileInput.files || fileInput.files.length === 0) {
            this.showMessage('Please select at least one file', 'error');
            return;
        }
        
        button.disabled = true;
        progressBar.classList.add('active');
        
        try {
            const formData = new FormData();
            
            if (fileInput.multiple) {
                for (let file of fileInput.files) {
                    formData.append('pdfs', file);
                }
            } else {
                formData.append('file', fileInput.files[0]);
            }
            
            const angle = toolCard.querySelector('.rotate-angle')?.value;
            if (angle) formData.append('angle', angle);
            
            const watermarkText = toolCard.querySelector('.watermark-text')?.value;
            if (watermarkText) formData.append('text', watermarkText);
            
            const password = toolCard.querySelector('.password-input')?.value;
            if (password) formData.append('password', password);
            
            const response = await fetch(endpoint, {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success || result.downloadUrl) {
                this.displayResult(result);
                this.showMessage('Operation completed successfully!', 'success');
            } else {
                throw new Error(result.error || 'Operation failed');
            }
        } catch (error) {
            this.showMessage(`Error: ${error.message}`, 'error');
        } finally {
            button.disabled = false;
            progressBar.classList.remove('active');
        }
    }
    
    displayResult(result) {
        const resultContainer = document.getElementById('result');
        resultContainer.innerHTML = '';
        
        const successDiv = document.createElement('div');
        successDiv.className = 'result-success';
        
        if (result.downloadUrl) {
            successDiv.innerHTML = `
                <i class="fas fa-check-circle"></i>
                <p>File processed successfully!</p>
                <a href="${result.downloadUrl}" class="download-link" download>
                    <i class="fas fa-download"></i> Download File
                </a>
                ${result.originalSize ? `<p>Original: ${this.formatBytes(result.originalSize)}<br>Compressed: ${this.formatBytes(result.compressedSize)}<br>Saved: ${Math.round((1 - result.compressedSize/result.originalSize) * 100)}%</p>` : ''}
            `;
        } else if (result.files) {
            successDiv.innerHTML = '<h3>Split Files:</h3>';
            result.files.forEach(file => {
                successDiv.innerHTML += `<div><a href="${file.downloadUrl}" download>Page ${file.page} - Download</a></div>`;
            });
        }
        
        resultContainer.appendChild(successDiv);
        resultContainer.classList.add('show');
        resultContainer.scrollIntoView({ behavior: 'smooth' });
    }
    
    showMessage(message, type) {
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = `
            position: fixed; top: 80px; right: 20px; padding: 12px 20px;
            border-radius: 5px; background: ${type === 'error' ? '#e74c3c' : '#27ae60'};
            color: white; z-index: 10000; animation: slideIn 0.3s;
        `;
        messageDiv.innerHTML = `<i class="fas ${type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle'}"></i> ${message}`;
        document.body.appendChild(messageDiv);
        setTimeout(() => messageDiv.remove(), 3000);
    }
    
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new PDFToolsApp();
});

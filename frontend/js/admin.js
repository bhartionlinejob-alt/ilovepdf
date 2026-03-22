class AdminPanel {
    constructor() {
        this.token = localStorage.getItem('adminToken');
        this.init();
    }
    
    async init() {
        if (!this.token) {
            await this.showLogin();
        } else {
            await this.loadSettings();
            this.setupEventListeners();
        }
    }
    
    async showLogin() {
        const password = prompt('Enter admin password:');
        if (password) {
            try {
                const response = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: 'admin', password })
                });
                
                const data = await response.json();
                if (data.success) {
                    this.token = data.token;
                    localStorage.setItem('adminToken', this.token);
                    await this.loadSettings();
                    this.setupEventListeners();
                } else {
                    alert('Invalid password');
                    this.showLogin();
                }
            } catch (error) {
                alert('Login failed');
                this.showLogin();
            }
        }
    }
    
    async loadSettings() {
        try {
            const response = await fetch('/api/admin/settings', {
                headers: { 'Authorization': this.token }
            });
            this.settings = await response.json();
            this.populateForm();
        } catch (error) {
            this.showNotification('Failed to load settings', 'error');
        }
    }
    
    populateForm() {
        document.getElementById('siteName').value = this.settings.siteName || '';
        document.getElementById('footerText').value = this.settings.footerText || '';
        document.getElementById('maxFileSize').value = this.settings.maxFileSize || 50;
        document.getElementById('theme').value = this.settings.theme || 'light';
        document.getElementById('primaryColor').value = this.settings.primaryColor || '#e74c3c';
        document.getElementById('secondaryColor').value = this.settings.secondaryColor || '#c0392b';
        document.getElementById('watermarkText').value = this.settings.watermarkText || 'WATERMARK';
        document.getElementById('adsenseEnabled').checked = this.settings.adsenseEnabled || false;
        document.getElementById('adsenseCode').value = this.settings.adsenseCode || '';
        document.getElementById('analyticsCode').value = this.settings.analyticsCode || '';
        document.getElementById('customCSS').value = this.settings.customCSS || '';
        document.getElementById('customJS').value = this.settings.customJS || '';
        document.getElementById('adminUsername').value = this.settings.adminUser?.username || 'admin';
        
        if (this.settings.siteLogo) {
            document.getElementById('logoPreview').innerHTML = `<img src="${this.settings.siteLogo}" alt="Logo">`;
        }
    }
    
    setupEventListeners() {
        document.querySelectorAll('.admin-sidebar nav a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const tab = link.dataset.tab;
                this.switchTab(tab);
            });
        });
        
        document.getElementById('save-settings').addEventListener('click', () => this.saveSettings());
        document.getElementById('logoUpload').addEventListener('change', (e) => this.uploadLogo(e));
        document.getElementById('changePassword').addEventListener('click', () => this.changePassword());
    }
    
    switchTab(tabId) {
        document.querySelectorAll('.admin-sidebar nav a').forEach(link => link.classList.remove('active'));
        document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');
    }
    
    async saveSettings() {
        const settings = {
            siteName: document.getElementById('siteName').value,
            footerText: document.getElementById('footerText').value,
            maxFileSize: parseInt(document.getElementById('maxFileSize').value),
            theme: document.getElementById('theme').value,
            primaryColor: document.getElementById('primaryColor').value,
            secondaryColor: document.getElementById('secondaryColor').value,
            watermarkText: document.getElementById('watermarkText').value,
            adsenseEnabled: document.getElementById('adsenseEnabled').checked,
            adsenseCode: document.getElementById('adsenseCode').value,
            analyticsCode: document.getElementById('analyticsCode').value,
            customCSS: document.getElementById('customCSS').value,
            customJS: document.getElementById('customJS').value,
            adminUser: { username: document.getElementById('adminUsername').value }
        };
        
        try {
            const response = await fetch('/api/admin/settings', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.token
                },
                body: JSON.stringify(settings)
            });
            
            const result = await response.json();
            if (result) {
                this.showNotification('Settings saved successfully!', 'success');
            }
        } catch (error) {
            this.showNotification('Failed to save settings', 'error');
        }
    }
    
    async uploadLogo(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const formData = new FormData();
        formData.append('logo', file);
        
        try {
            const response = await fetch('/api/admin/upload-logo', {
                method: 'POST',
                headers: { 'Authorization': this.token },
                body: formData
            });
            
            const result = await response.json();
            if (result.success) {
                document.getElementById('logoPreview').innerHTML = `<img src="${result.logoUrl}" alt="Logo">`;
                this.showNotification('Logo uploaded successfully!', 'success');
            }
        } catch (error) {
            this.showNotification('Failed to upload logo', 'error');
        }
    }
    
    async changePassword() {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        
        if (!currentPassword || !newPassword) {
            this.showNotification('Please fill in all fields', 'error');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            this.showNotification('New passwords do not match', 'error');
            return;
        }
        
        try {
            const response = await fetch('/api/admin/change-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.token
                },
                body: JSON.stringify({ currentPassword, newPassword })
            });
            
            const result = await response.json();
            if (result.success) {
                this.showNotification('Password changed successfully!', 'success');
                document.getElementById('currentPassword').value = '';
                document.getElementById('newPassword').value = '';
                document.getElementById('confirmPassword').value = '';
            }
        } catch (error) {
            this.showNotification('Failed to change password', 'error');
        }
    }
    
    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.add('show');
        setTimeout(() => notification.classList.remove('show'), 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new AdminPanel();
});

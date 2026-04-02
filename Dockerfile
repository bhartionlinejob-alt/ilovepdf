# Use official Node.js runtime as base image
FROM node:18-slim

# Install LibreOffice and required dependencies
RUN apt-get update && \
    apt-get install -y \
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    fonts-liberation \
    fonts-dejavu \
    fonts-noto \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy application code
COPY . .

# Create temp directory for file processing
RUN mkdir -p /app/temp

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]

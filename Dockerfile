# Use an image with LibreOffice pre-installed
FROM node:18-slim

# Install LibreOffice and ALL dependencies in one go
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    fonts-liberation \
    fonts-dejavu \
    fonts-noto-cjk \
    libxinerama1 \
    libcairo2 \
    libcups2 \
    libavahi-common3 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Set library path (CRITICAL - fixes missing libreglo.so error)
ENV LD_LIBRARY_PATH="/usr/lib/libreoffice/program:$LD_LIBRARY_PATH"

# Set path for soffice command
ENV PATH="/usr/lib/libreoffice/program:$PATH"

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN mkdir -p temp

EXPOSE 3000
CMD ["npm", "start"]

# Gunakan image Node.js yang ringan berbasis Alpine Linux
FROM node:20-alpine

# Set variabel env untuk produksi
ENV NODE_ENV=production
ENV PORT=8000

# Buat direktori kerja di dalam container
WORKDIR /app

# Salin package.json dan package-lock.json terlebih dahulu
COPY package*.json ./

# Instal dependensi produksi saja
RUN npm ci --only=production

# Salin seluruh kode aplikasi (kecuali yang diabaikan oleh .dockerignore)
COPY . .

# Buka port 8000 untuk diakses dari luar container
EXPOSE 8000

# Jalankan perintah start aplikasi
CMD ["npm", "start"]

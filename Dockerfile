# File: backend/Dockerfile
# Dockerfile for Study Assistant AI Backend (Node.js + Express + MongoDB client)

FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install system deps if needed (e.g. for sharp, though we don't use it now)
RUN apk add --no-cache bash

# Copy package.json & package-lock (if present) first for better cache
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy source code
COPY . .

# Expose backend port (matches PORT in .env, default 5000)
EXPOSE 5000

# Start the server
CMD ["npm", "start"]

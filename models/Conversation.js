// File: backend/models/Conversation.js
// Stores chat history between user and AI for each document

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
    {
        role: {
            type: String,
            enum: ['user', 'assistant', 'system'],
            required: true
        },
        text: {
            type: String,
            required: true
        },
        meta: {
            type: Object,
            default: {}
        }
    },
    { timestamps: true }
);

const conversationSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        documentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Document',
            required: true,
            index: true
        },
        messages: [messageSchema]
    },
    { timestamps: true }
);

// Helpful compound index for faster lookups
conversationSchema.index({ userId: 1, documentId: 1 });

module.exports = mongoose.model('Conversation', conversationSchema);

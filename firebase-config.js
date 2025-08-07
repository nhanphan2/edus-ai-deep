// firebase-config.js - VIẾT LẠI HOÀN TOÀN KHÔNG CẦN INDEX
const { initializeApp } = require('firebase/app');
const { 
    getFirestore, 
    collection, 
    addDoc, 
    query, 
    where, 
    getDocs, 
    deleteDoc,
    doc,
    serverTimestamp,
    Timestamp
} = require('firebase/firestore');

// Cấu hình Firebase
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

// Khởi tạo Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ===== UTILITY FUNCTIONS =====

// Tạo expires timestamp (24h từ bây giờ)
function createExpiresAt() {
    const now = new Date();
    const expires = new Date(now.getTime() + (24 * 60 * 60 * 1000));
    return Timestamp.fromDate(expires);
}

// Kiểm tra document đã hết hạn chưa
function isExpired(expiresAt) {
    if (!expiresAt) return false;
    return expiresAt.toDate() < new Date();
}

// ===== CHAT FUNCTIONS - KHÔNG CẦN INDEX =====

// Lưu message vào Firestore
async function saveMessageToFirestore(ipHash, content, sender, images = []) {
    try {
        console.log(`💾 Saving ${sender} message to Firestore for IP hash: ${ipHash.substring(0, 8)}...`);
        
        const messageData = {
            ipHash: ipHash,
            content: content,
            sender: sender,
            images: images || [],
            createdAt: serverTimestamp(),
            expiresAt: createExpiresAt()
        };

        const docRef = await addDoc(collection(db, 'chatSessions'), messageData);
        console.log(`✅ Saved ${sender} message to Firestore:`, docRef.id);
        return true;
        
    } catch (error) {
        console.error('❌ Exception saving message to Firestore:', error);
        return false;
    }
}

// Lấy messages từ Firestore - QUERY ĐƠN GIẢN NHẤT
async function getMessagesFromFirestore(ipHash) {
    try {
        console.log(`📖 Loading messages from Firestore for IP hash: ${ipHash.substring(0, 8)}...`);
        
        // QUERY ĐƠN GIẢN - CHỈ WHERE DUY NHẤT
        const q = query(
            collection(db, 'chatSessions'),
            where('ipHash', '==', ipHash)
        );

        const querySnapshot = await getDocs(q);
        const messages = [];
        let sessionInfo = null;
        const now = new Date();

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            
            // Filter expired ở JavaScript
            if (!data.expiresAt || data.expiresAt.toDate() > now) {
                messages.push({
                    id: doc.id,
                    content: data.content,
                    sender: data.sender,
                    images: data.images || [],
                    timestamp: data.createdAt ? data.createdAt.toMillis() : Date.now(),
                    createdAt: data.createdAt ? data.createdAt.toDate() : new Date()
                });

                // Session info từ message đầu tiên
                if (!sessionInfo && data.createdAt && data.expiresAt) {
                    sessionInfo = {
                        messageCount: 1,
                        createdAt: data.createdAt.toMillis(),
                        expiresAt: data.expiresAt.toMillis(),
                        timeRemaining: Math.max(0, data.expiresAt.toMillis() - Date.now())
                    };
                }
            }
        });

        // Sắp xếp theo thời gian ở JavaScript
        messages.sort((a, b) => a.createdAt - b.createdAt);

        // Update message count
        if (sessionInfo) {
            sessionInfo.messageCount = messages.length;
        }

        console.log(`✅ Loaded ${messages.length} messages from Firestore`);
        return { messages, sessionInfo };
        
    } catch (error) {
        console.error('❌ Exception loading messages from Firestore:', error);
        return { messages: [], sessionInfo: null };
    }
}

// Xóa messages hết hạn - KHÔNG CẦN INDEX
async function cleanupExpiredMessages() {
    try {
        console.log('🧹 Cleaning up expired chat messages...');
        
        // Lấy tất cả messages, filter ở JavaScript
        const q = query(collection(db, 'chatSessions'));
        const querySnapshot = await getDocs(q);
        const deletePromises = [];
        const now = new Date();

        querySnapshot.forEach((document) => {
            const data = document.data();
            if (data.expiresAt && data.expiresAt.toDate() < now) {
                deletePromises.push(deleteDoc(doc(db, 'chatSessions', document.id)));
            }
        });

        await Promise.all(deletePromises);
        console.log(`✅ Cleaned up ${deletePromises.length} expired chat messages`);
        
    } catch (error) {
        console.error('❌ Exception cleaning up expired messages:', error);
    }
}

// Xóa tất cả messages của một IP
async function clearMessagesForIP(ipHash) {
    try {
        console.log(`🗑️ Clearing all messages for IP hash: ${ipHash.substring(0, 8)}...`);
        
        const q = query(
            collection(db, 'chatSessions'),
            where('ipHash', '==', ipHash)
        );

        const querySnapshot = await getDocs(q);
        const deletePromises = [];

        querySnapshot.forEach((document) => {
            deletePromises.push(deleteDoc(doc(db, 'chatSessions', document.id)));
        });

        await Promise.all(deletePromises);
        console.log(`✅ Cleared ${deletePromises.length} messages for IP`);
        return true;
        
    } catch (error) {
        console.error('❌ Exception clearing messages:', error);
        return false;
    }
}

// ===== EXERCISE FUNCTIONS - KHÔNG CẦN INDEX =====

async function saveExerciseToFirestore(ipHash, content, sender, formData = {}) {
    try {
        console.log(`💾 Saving ${sender} exercise to Firestore for IP hash: ${ipHash.substring(0, 8)}...`);
        
        const exerciseData = {
            ipHash: ipHash,
            content: content,
            sender: sender,
            subject: formData.subject || null,
            grade: formData.grade || null,
            difficulty: formData.difficulty || null,
            topic: formData.topic || null,
            quantity: formData.quantity || null,
            formData: formData,
            createdAt: serverTimestamp(),
            expiresAt: createExpiresAt()
        };

        const docRef = await addDoc(collection(db, 'exerciseSessions'), exerciseData);
        console.log(`✅ Saved ${sender} exercise to Firestore:`, docRef.id);
        return true;
        
    } catch (error) {
        console.error('❌ Exception saving exercise to Firestore:', error);
        return false;
    }
}

async function getExercisesFromFirestore(ipHash) {
    try {
        console.log(`📖 Loading exercises from Firestore for IP hash: ${ipHash.substring(0, 8)}...`);
        
        // QUERY ĐƠN GIẢN - CHỈ WHERE
        const q = query(
            collection(db, 'exerciseSessions'),
            where('ipHash', '==', ipHash)
        );

        const querySnapshot = await getDocs(q);
        const data = [];
        const now = new Date();

        querySnapshot.forEach((doc) => {
            const docData = doc.data();
            
            // Filter expired ở JavaScript
            if (!docData.expiresAt || docData.expiresAt.toDate() > now) {
                data.push({
                    id: doc.id,
                    ...docData,
                    createdAt: docData.createdAt ? docData.createdAt.toDate() : new Date()
                });
            }
        });

        // Sắp xếp ở JavaScript
        data.sort((a, b) => a.createdAt - b.createdAt);

        console.log(`✅ Loaded ${data.length} exercises from Firestore`);
        
        const exercises = [];
        for (let i = 0; i < data.length; i += 2) {
            const userMsg = data[i];
            const aiMsg = data[i + 1];
            
            if (userMsg && aiMsg && userMsg.sender === 'user' && aiMsg.sender === 'ai') {
                exercises.push({
                    prompt: userMsg.content,
                    result: aiMsg.content,
                    formData: userMsg.formData || {},
                    timestamp: userMsg.createdAt.getTime()
                });
            }
        }
        
        return { exercises: exercises.slice(-5) };
        
    } catch (error) {
        console.error('❌ Exception loading exercises from Firestore:', error);
        return { exercises: [] };
    }
}

async function cleanupExpiredExercises() {
    try {
        console.log('🧹 Cleaning up expired exercises...');
        
        // Lấy tất cả, filter ở JavaScript
        const q = query(collection(db, 'exerciseSessions'));
        const querySnapshot = await getDocs(q);
        const deletePromises = [];
        const now = new Date();

        querySnapshot.forEach((document) => {
            const data = document.data();
            if (data.expiresAt && data.expiresAt.toDate() < now) {
                deletePromises.push(deleteDoc(doc(db, 'exerciseSessions', document.id)));
            }
        });

        await Promise.all(deletePromises);
        console.log(`✅ Cleaned up ${deletePromises.length} expired exercises`);
        
    } catch (error) {
        console.error('❌ Exception cleaning up expired exercises:', error);
    }
}

async function clearExercisesForIP(ipHash) {
    try {
        console.log(`🗑️ Clearing all exercises for IP hash: ${ipHash.substring(0, 8)}...`);
        
        const q = query(
            collection(db, 'exerciseSessions'),
            where('ipHash', '==', ipHash)
        );

        const querySnapshot = await getDocs(q);
        const deletePromises = [];

        querySnapshot.forEach((document) => {
            deletePromises.push(deleteDoc(doc(db, 'exerciseSessions', document.id)));
        });

        await Promise.all(deletePromises);
        console.log(`✅ Cleared ${deletePromises.length} exercises for IP`);
        return true;
        
    } catch (error) {
        console.error('❌ Exception clearing exercises:', error);
        return false;
    }
}

// ===== LITERATURE FUNCTIONS - KHÔNG CẦN INDEX =====

async function saveLiteratureToFirestore(ipHash, content, sender, formData = {}) {
    try {
        console.log(`💾 Saving ${sender} literature to Firestore for IP hash: ${ipHash.substring(0, 8)}...`);
        
        const literatureData = {
            ipHash: ipHash,
            content: content,
            sender: sender,
            genre: formData.genre || null,
            period: formData.period || null,
            author: formData.author || null,
            workType: formData.workType || null,
            analysisType: formData.analysisType || null,
            formData: formData,
            createdAt: serverTimestamp(),
            expiresAt: createExpiresAt()
        };

        const docRef = await addDoc(collection(db, 'literatureSessions'), literatureData);
        console.log(`✅ Saved ${sender} literature to Firestore:`, docRef.id);
        return true;
        
    } catch (error) {
        console.error('❌ Exception saving literature to Firestore:', error);
        return false;
    }
}

async function getLiteratureFromFirestore(ipHash) {
    try {
        console.log(`📖 Loading literature from Firestore for IP hash: ${ipHash.substring(0, 8)}...`);
        
        // QUERY ĐƠN GIẢN - CHỈ WHERE
        const q = query(
            collection(db, 'literatureSessions'),
            where('ipHash', '==', ipHash)
        );

        const querySnapshot = await getDocs(q);
        const data = [];
        const now = new Date();

        querySnapshot.forEach((doc) => {
            const docData = doc.data();
            
            // Filter expired ở JavaScript
            if (!docData.expiresAt || docData.expiresAt.toDate() > now) {
                data.push({
                    id: doc.id,
                    ...docData,
                    createdAt: docData.createdAt ? docData.createdAt.toDate() : new Date()
                });
            }
        });

        // Sắp xếp ở JavaScript
        data.sort((a, b) => a.createdAt - b.createdAt);

        console.log(`✅ Loaded ${data.length} literature entries from Firestore`);
        
        const literatureEntries = [];
        for (let i = 0; i < data.length; i += 2) {
            const userMsg = data[i];
            const aiMsg = data[i + 1];
            
            if (userMsg && aiMsg && userMsg.sender === 'user' && aiMsg.sender === 'ai') {
                literatureEntries.push({
                    prompt: userMsg.content,
                    result: aiMsg.content,
                    formData: userMsg.formData || {},
                    timestamp: userMsg.createdAt.getTime()
                });
            }
        }
        
        return { literature: literatureEntries.slice(-5) };
        
    } catch (error) {
        console.error('❌ Exception loading literature from Firestore:', error);
        return { literature: [] };
    }
}

async function cleanupExpiredLiterature() {
    try {
        console.log('🧹 Cleaning up expired literature...');
        
        // Lấy tất cả, filter ở JavaScript
        const q = query(collection(db, 'literatureSessions'));
        const querySnapshot = await getDocs(q);
        const deletePromises = [];
        const now = new Date();

        querySnapshot.forEach((document) => {
            const data = document.data();
            if (data.expiresAt && data.expiresAt.toDate() < now) {
                deletePromises.push(deleteDoc(doc(db, 'literatureSessions', document.id)));
            }
        });

        await Promise.all(deletePromises);
        console.log(`✅ Cleaned up ${deletePromises.length} expired literature`);
        
    } catch (error) {
        console.error('❌ Exception cleaning up expired literature:', error);
    }
}

async function clearLiteratureForIP(ipHash) {
    try {
        console.log(`🗑️ Clearing all literature for IP hash: ${ipHash.substring(0, 8)}...`);
        
        const q = query(
            collection(db, 'literatureSessions'),
            where('ipHash', '==', ipHash)
        );

        const querySnapshot = await getDocs(q);
        const deletePromises = [];

        querySnapshot.forEach((document) => {
            deletePromises.push(deleteDoc(doc(db, 'literatureSessions', document.id)));
        });

        await Promise.all(deletePromises);
        console.log(`✅ Cleared ${deletePromises.length} literature for IP`);
        return true;
        
    } catch (error) {
        console.error('❌ Exception clearing literature:', error);
        return false;
    }
}

// ===== QUESTIONS FUNCTIONS - ĐƠN GIẢN =====

async function saveQuestion(question, userIP) {
    try {
        console.log('🔄 Đang lưu câu hỏi vào Firestore...');
        console.log('📝 Câu hỏi:', question);
        
        const questionData = {
            question: question,
            userIP: userIP,
            timestamp: serverTimestamp()
        };

        const docRef = await addDoc(collection(db, 'questions'), questionData);
        console.log('✅ Đã lưu câu hỏi vào Firestore:', docRef.id);
        
    } catch (error) {
        console.error('❌ Exception khi lưu câu hỏi:', error);
    }
}

async function getQuestions(limitCount = 50) {
    try {
        console.log('🔍 Đang lấy câu hỏi từ Firestore...');
        
        // Lấy tất cả, sort ở JavaScript
        const q = query(collection(db, 'questions'));
        const querySnapshot = await getDocs(q);
        const questions = [];

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            questions.push({
                id: doc.id,
                question: data.question,
                userIP: data.userIP,
                timestamp: data.timestamp ? data.timestamp.toDate() : new Date(),
                timestampISO: data.timestamp ? data.timestamp.toDate().toISOString() : new Date().toISOString()
            });
        });

        // Sort ở JavaScript và limit
        questions.sort((a, b) => b.timestamp - a.timestamp);
        const limitedQuestions = questions.slice(0, limitCount).map(q => ({
            id: q.id,
            question: q.question,
            userIP: q.userIP,
            timestamp: q.timestampISO
        }));

        console.log(`✅ Lấy được ${limitedQuestions.length} câu hỏi từ Firestore`);
        return limitedQuestions;
        
    } catch (error) {
        console.error('❌ Exception khi lấy câu hỏi:', error);
        return [];
    }
}

async function countQuestions() {
    try {
        const q = query(collection(db, 'questions'));
        const querySnapshot = await getDocs(q);
        return querySnapshot.size;
        
    } catch (error) {
        console.error('❌ Lỗi khi đếm câu hỏi:', error);
        return 0;
    }
}

// ===== STATS FUNCTIONS - KHÔNG CẦN INDEX =====

async function getChatStats() {
    try {
        // Lấy tất cả chat sessions, filter ở JavaScript
        const q = query(collection(db, 'chatSessions'));
        const querySnapshot = await getDocs(q);
        const sessionMap = new Map();
        const now = new Date();
        let totalActiveMessages = 0;

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            
            // Filter expired ở JavaScript
            if (!data.expiresAt || data.expiresAt.toDate() > now) {
                totalActiveMessages++;
                const key = data.ipHash;
                
                if (!sessionMap.has(key)) {
                    sessionMap.set(key, {
                        ipHash: key.substring(0, 8) + '...',
                        messageCount: 0,
                        firstMessage: data.createdAt,
                        expiresAt: data.expiresAt
                    });
                }
                sessionMap.get(key).messageCount++;
            }
        });

        const stats = {
            totalSessions: sessionMap.size,
            totalMessages: totalActiveMessages,
            sessionsInfo: Array.from(sessionMap.values()).map(session => ({
                ...session,
                createdAt: session.firstMessage ? session.firstMessage.toMillis() : Date.now(),
                timeRemaining: Math.max(0, (session.expiresAt ? session.expiresAt.toMillis() : Date.now()) - Date.now())
            }))
        };

        return stats;
        
    } catch (error) {
        console.error('❌ Exception getting chat stats:', error);
        return { totalSessions: 0, totalMessages: 0, sessionsInfo: [] };
    }
}

// Export tất cả functions
module.exports = {
    db,
    // Chat functions
    saveMessageToFirestore,
    getMessagesFromFirestore,
    cleanupExpiredMessages,
    clearMessagesForIP,
    // Exercise functions
    saveExerciseToFirestore,
    getExercisesFromFirestore,
    cleanupExpiredExercises,
    clearExercisesForIP,
    // Literature functions
    saveLiteratureToFirestore,
    getLiteratureFromFirestore,
    cleanupExpiredLiterature,
    clearLiteratureForIP,
    // Questions functions
    saveQuestion,
    getQuestions,
    countQuestions,
    // Stats functions
    getChatStats
};
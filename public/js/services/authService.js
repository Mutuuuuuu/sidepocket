import { getFirebaseServices } from './firebaseService.js';
import { onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { createUserProfile, getUserProfile } from './firestoreService.js';
import { toggleLoading, showStatus } from './uiService.js';

const auth = () => getFirebaseServices().auth;

export const attachAuthListener = () => {
    return new Promise((resolve) => {
        onAuthStateChanged(auth(), async (user) => {
            const isAuthPage = window.location.pathname.includes('login.html') || window.location.pathname.includes('signup.html');
            if (user) {
                if (isAuthPage) return window.location.replace('/');
                
                const userProfile = await getUserProfile(user.uid);
                if (!userProfile) {
                    await createUserProfile(user.uid, {
                        email: user.email,
                        displayName: user.displayName || 'Guest',
                        photoURL: user.photoURL || null,
                    });
                } else if (user.displayName !== userProfile.displayName || user.photoURL !== userProfile.photoURL) {
                    await updateProfile(user, { 
                        displayName: userProfile.displayName, 
                        photoURL: userProfile.photoURL 
                    });
                }
                resolve(user);
            } else {
                if (!isAuthPage) return window.location.replace('/login.html');
                resolve(null);
            }
        });
    });
};

export const loadHeader = async () => {
    const headerPlaceholder = document.getElementById('header-placeholder');
    if (!headerPlaceholder) return;
    try {
        const response = await fetch('/header.html');
        if (!response.ok) throw new Error('header.htmlの読み込みに失敗');
        headerPlaceholder.innerHTML = await response.text();
        
        document.getElementById('logout-button')?.addEventListener('click', () => {
            toggleLoading(true);
            signOut(auth()).catch(error => {
                showStatus(`ログアウトに失敗しました: ${error.message}`, true);
            }).finally(() => {
                toggleLoading(false);
            });
        });

    } catch (error) {
        console.error("Header load error:", error);
    }
};

export const handleEmailSignup = async (email, password, displayName) => {
    const userCredential = await createUserWithEmailAndPassword(auth(), email, password);
    await updateProfile(userCredential.user, { displayName });
    await createUserProfile(userCredential.user.uid, {
      email: userCredential.user.email,
      displayName: displayName,
      photoURL: null,
    });
    return userCredential.user;
};

export const handleEmailLogin = (email, password) => {
    return signInWithEmailAndPassword(auth(), email, password);
};

export const handleGoogleLogin = () => {
    const provider = new GoogleAuthProvider();
    return signInWithPopup(auth(), provider);
};
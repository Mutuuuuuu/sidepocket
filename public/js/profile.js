import { getFirebaseServices } from './services/firebaseService.js';
import { updateProfile as updateAuthProfile } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { getUserProfile, updateUserProfile } from './services/firestoreService.js';
import { toggleLoading, showStatus } from './services/uiService.js';

// DOM要素
let profileForm, iconPreview, iconInput, displayNameInput, lastNameInput, firstNameInput;

let currentUser, currentAuthUser;
let selectedFile = null; // 選択された画像ファイルを保持

/**
 * プロフィールページの初期化
 * @param {object} user - ログインユーザーオブジェクト
 */
export const initProfilePage = async (user) => {
    currentAuthUser = user;

    // DOM要素を取得
    profileForm = document.getElementById('profile-form');
    iconPreview = document.getElementById('user-icon-preview');
    iconInput = document.getElementById('icon-upload-input');
    displayNameInput = document.getElementById('display-name-input');
    lastNameInput = document.getElementById('last-name-input');
    firstNameInput = document.getElementById('first-name-input');
    
    // イベントリスナーを設定
    profileForm.addEventListener('submit', handleProfileUpdate);
    iconInput.addEventListener('change', handleFileSelect);

    // フォームに現在のプロフィール情報を設定
    await populateProfileForm();
    toggleLoading(false);
};

/**
 * Firestoreからプロフィール情報を取得し、フォームに表示する
 */
const populateProfileForm = async () => {
    const userProfile = await getUserProfile(currentAuthUser.uid);
    if (!userProfile) {
        showStatus('プロファイル情報の取得に失敗しました。', true);
        return;
    }
    
    // Authの情報とFirestoreの情報を組み合わせる
    displayNameInput.value = userProfile.displayName || currentAuthUser.displayName || '';
    lastNameInput.value = userProfile.lastName || '';
    firstNameInput.value = userProfile.firstName || '';
    iconPreview.src = userProfile.photoURL || currentAuthUser.photoURL || 'images/sidepocket_symbol.png';
    iconPreview.onerror = () => { iconPreview.src = 'images/sidepocket_symbol.png'; };
};

/**
 * ファイルが選択された際にプレビューを更新する
 * @param {Event} e - ファイル選択イベント
 */
const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
        selectedFile = file;
        const reader = new FileReader();
        reader.onload = (event) => {
            iconPreview.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
};

/**
 * プロフィール更新処理
 * @param {Event} e - フォーム送信イベント
 */
const handleProfileUpdate = async (e) => {
    e.preventDefault();
    toggleLoading(true);

    try {
        const { storage } = getFirebaseServices();
        let photoURL = currentAuthUser.photoURL;

        // 1. 画像が新しく選択されていたら、Storageにアップロード
        if (selectedFile) {
            const filePath = `profile-icons/${currentAuthUser.uid}/${Date.now()}_${selectedFile.name}`;
            const storageRef = ref(storage, filePath);
            const snapshot = await uploadBytes(storageRef, selectedFile);
            photoURL = await getDownloadURL(snapshot.ref);
        }

        const newDisplayName = displayNameInput.value;
        const newLastName = lastNameInput.value;
        const newFirstName = firstNameInput.value;

        // 2. Firebase Authenticationのプロフィールを更新
        await updateAuthProfile(currentAuthUser, {
            displayName: newDisplayName,
            photoURL: photoURL
        });

        // 3. Firestoreのユーザー情報を更新
        await updateUserProfile(currentAuthUser.uid, {
            displayName: newDisplayName,
            lastName: newLastName,
            firstName: newFirstName,
            photoURL: photoURL
        });

        showStatus('プロフィールを更新しました。ページをリロードします。', false, 2000);
        // ヘッダーの情報も更新するためにページをリロード
        setTimeout(() => window.location.reload(), 2000);

    } catch (error) {
        console.error("Profile update error:", error);
        showStatus(`エラーが発生しました: ${error.message}`, true);
        toggleLoading(false);
    } finally {
        selectedFile = null; // 処理後にリセット
    }
};
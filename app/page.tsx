"use client";

import { useEffect, useState } from "react";
import { ArrowRight, AudioLines, ShieldCheck, Sparkles, WandSparkles, Mic2, UploadCloud, LogOut, X } from "lucide-react";
import { createClient, SupabaseClient, User } from "@supabase/supabase-js";
import { oauthHandleRedirectIfPresent, oauthLoginUrl } from "@huggingface/hub";
import { Client, handle_file } from "@gradio/client";


type AudioHistoryItem = {
  id: string;
  userId: string;
  text: string;
  createdAt: string;
  contentType: string;
  blob: Blob;
};

const AUDIO_DB = "creovanta-audio-history";
const AUDIO_STORE = "generated-audio";

function openAudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUDIO_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        const store = db.createObjectStore(AUDIO_STORE, { keyPath: "id" });
        store.createIndex("userId", "userId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveAudioRecord(record: AudioHistoryItem) {
  const db = await openAudioDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, "readwrite");
    tx.objectStore(AUDIO_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getAudioRecords(userId: string): Promise<AudioHistoryItem[]> {
  const db = await openAudioDb();
  const records = await new Promise<AudioHistoryItem[]>((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, "readonly");
    const request = tx.objectStore(AUDIO_STORE).index("userId").getAll(userId);
    request.onsuccess = () => resolve(request.result as AudioHistoryItem[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function removeAudioRecord(id: string) {
  const db = await openAudioDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, "readwrite");
    tx.objectStore(AUDIO_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

type VoiceProfile = {
  id: string;
  name: string;
  description: string | null;
  language_code: string;
  status: string;
  consent_type: "self" | "authorized";
  reference_text: string | null;
  created_at: string;
  source_audio_path: string;
};

const BUCKET = "voice-samples";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ACCEPTED_TYPES = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/flac", "audio/ogg"];

export default function Home() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const DEFAULT_VOICE_DESCRIPTION = "Speak naturally and clearly. Keep the original voice, tone, pronunciation, and speaking style consistent.";
  const [voiceDescription, setVoiceDescription] = useState(DEFAULT_VOICE_DESCRIPTION);
  const [referenceTranscript, setReferenceTranscript] = useState("");
  const [hfAccessToken, setHfAccessToken] = useState("");
  const [hfUsername, setHfUsername] = useState("");
  const [consentType, setConsentType] = useState<"self" | "authorized">("self");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [speechText, setSpeechText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioExtension, setAudioExtension] = useState("wav");
  const [clonePreviewUrl, setClonePreviewUrl] = useState("");
  const [audioHistory, setAudioHistory] = useState<Array<{id:string;text:string;createdAt:string;url:string;extension:string}>>([]);
  const [historyMessage, setHistoryMessage] = useState("");

  useEffect(() => {
    let active = true;
    oauthHandleRedirectIfPresent().then((result) => {
      if (!active || !result) return;
      const oauth = result as unknown as { accessToken: string; userInfo?: { preferred_username?: string; name?: string } };
      setHfAccessToken(oauth.accessToken);
      setHfUsername(oauth.userInfo?.preferred_username || oauth.userInfo?.name || "Connected");
      window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    }).catch(() => {
      if (active) setMessage("Generation account connection did not finish. Please try again.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      setMessage("Supabase configuration is missing. Please check the deployment environment.");
      return;
    }
    const client = createClient(url, key);
    setSupabase(client);
    client.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !user) {
      setProfiles([]);
      return;
    }
    loadProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, user?.id]);

  async function loadProfiles(preferredProfileId?: string) {
    if (!supabase || !user) return;
    const { data, error } = await supabase
      .from("voice_profiles")
      .select("id,name,description,language_code,status,consent_type,reference_text,source_audio_path,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) setMessage("Could not load your voice library: " + error.message);
    else {
      const nextProfiles = (data ?? []) as VoiceProfile[];
      setProfiles(nextProfiles);
      const readyProfiles = nextProfiles.filter(profile => profile.status === "ready" && profile.reference_text && profile.source_audio_path);
      setSelectedProfileId((current) => preferredProfileId && readyProfiles.some(profile => profile.id === preferredProfileId) ? preferredProfileId : (readyProfiles.some(profile => profile.id === current) ? current : readyProfiles[0]?.id || ""));
    }
  }

  async function connectGenerationAccount() {
    try {
      const clientId = "https://creovanta-omega.vercel.app/.well-known/oauth-cimd";
      const redirectUrl = "https://creovanta-omega.vercel.app/";
      const url = await oauthLoginUrl({ clientId, redirectUrl, scopes: "openid profile inference-api" });
      window.location.assign(url);
    } catch {
      setMessage("Could not start the account connection. Please try again.");
    }
  }


  const MAYA_SPACE = "maya-research/maya2-native-studio";
  const MAYA_SPACE_ORIGIN = "https://maya-research-maya2-native-studio.hf.space";

  async function runMayaClone(text: string, sample: Blob, transcript: string, referenceLanguage = "bn") {
    if (!transcript.trim()) throw new Error("Reference Transcript লিখতে হবে।");

    // Maya's /clone_speak endpoint declares ref_audio as a plain string, not
    // Gradio FileData. Upload explicitly, then pass the returned server path.
    setMessage("Maya-তে reference audio আপলোড হচ্ছে…");
    const sampleExtension = sample.type.includes("mpeg") ? "mp3"
      : sample.type.includes("wav") ? "wav"
      : sample.type.includes("flac") ? "flac"
      : sample.type.includes("ogg") ? "ogg"
      : "audio";
    const sampleName = sample instanceof File && sample.name
      ? sample.name
      : "creovanta-reference." + sampleExtension;
    const sampleFile = new File([sample], sampleName, {
      type: sample.type || "application/octet-stream",
    });
    const formData = new FormData();
    formData.append("files", sampleFile, sampleFile.name);
    const uploadResponse = await fetch(MAYA_SPACE_ORIGIN + "/gradio_api/upload", {
      method: "POST",
      body: formData,
    });
    if (!uploadResponse.ok) {
      const detail = await uploadResponse.text().catch(() => "");
      throw new Error("Maya audio upload ব্যর্থ (HTTP " + uploadResponse.status + "). " + detail.slice(0, 300));
    }
    const uploadedPaths = await uploadResponse.json() as unknown;
    const refAudioPath = Array.isArray(uploadedPaths) && typeof uploadedPaths[0] === "string"
      ? uploadedPaths[0]
      : "";
    if (!refAudioPath) throw new Error("Maya upload endpoint কোনো server file path ফেরত দেয়নি।");

    const args = [text, refAudioPath, transcript.trim(), referenceLanguage, "bn", true, 0, true];
    const invoke = async (token?: string) => {
      const client = await Client.connect(
        MAYA_SPACE,
        token ? { token: token as `hf_${string}` } : undefined,
      );
      try {
        return await client.predict("/clone_speak", args);
      } finally {
        const close = (client as unknown as { close?: () => void }).close;
        if (typeof close === "function") close.call(client);
      }
    };
    setMessage("Maya GPU-তে voice cloning request পাঠানো হয়েছে…");
    // The Maya Space is public. Call it anonymously first so a restricted or
    // stale personal HF token cannot break an otherwise public inference call.
    let result;
    try {
      result = await invoke();
    } catch (anonymousError) {
      const reason = anonymousError instanceof Error ? anonymousError.message : String(anonymousError);
      if (!hfAccessToken || !/401|403|unauthori[sz]ed|authentication|login required/i.test(reason)) {
        throw new Error("Maya Clone API ব্যর্থ: " + reason);
      }
      try {
        result = await invoke(hfAccessToken);
      } catch (authenticatedError) {
        const detail = authenticatedError instanceof Error ? authenticatedError.message : String(authenticatedError);
        throw new Error("Maya Clone API ব্যর্থ (anonymous ও authenticated—দুই চেষ্টাই ব্যর্থ): " + detail);
      }
    }
    const raw = Array.isArray(result.data) ? result.data[0] : result.data;
    const output = raw as { audio_url?: string; url?: string; duration?: number } | null;
    const returnedPath = output?.audio_url || output?.url;
    if (!returnedPath) throw new Error("Maya API অডিওর লিংক ফেরত দেয়নি। Response: " + JSON.stringify(raw).slice(0, 500));
    const audioUrl = new URL(returnedPath, MAYA_SPACE_ORIGIN + "/");
    if (audioUrl.origin !== MAYA_SPACE_ORIGIN) throw new Error("Maya অডিওর ঠিকানা নিরাপদ নয়।");
    setMessage("Maya-র তৈরি অডিও ডাউনলোড হচ্ছে…");
    let audioResponse = await fetch(audioUrl.toString(), hfAccessToken ? { headers: { Authorization: "Bearer " + hfAccessToken } } : undefined);
    if ((audioResponse.status === 401 || audioResponse.status === 403) && hfAccessToken) audioResponse = await fetch(audioUrl.toString());
    if (!audioResponse.ok) {
      const detail = await audioResponse.text().catch(() => "");
      throw new Error("Maya অডিও ফাইল আনতে পারেনি (HTTP " + audioResponse.status + "). " + detail.slice(0, 250));
    }
    const blob = await audioResponse.blob();
    if (!blob.size) throw new Error("Maya খালি অডিও পাঠিয়েছে।");
    const contentType = audioResponse.headers.get("content-type") || "audio/wav";
    if (!contentType.startsWith("audio/") && !contentType.includes("octet-stream")) throw new Error("Maya অডিওর বদলে অন্য Response পাঠিয়েছে: " + contentType);
    return { blob, contentType };
  }

  async function transcribeAudio(sample: Blob): Promise<string> {
    if (!hfAccessToken) throw new Error("আগে generation account connect করো।");
    const client = await Client.connect("bengaliAI/regional_bengali-asr_tugstugi_whisper-medium", {
      token: hfAccessToken as `hf_${string}`,
    });
    try {
      const result = await client.predict("/transcribe", [handle_file(sample)]);
      const raw = Array.isArray(result.data) ? result.data[0] : result.data;
      const transcript = typeof raw === "string" ? raw.trim() : "";
      if (!transcript) throw new Error("অডিও থেকে কথা শনাক্ত করা যায়নি। পরিষ্কার বাংলা অডিও দিয়ে আবার চেষ্টা করো।");
      return transcript;
    } finally {
      const close = (client as unknown as { close?: () => void }).close;
      if (typeof close === "function") close.call(client);
    }
  }

  async function updateVoiceProfileStatus(profileId: string, status: "ready" | "failed") {
    if (!supabase || !hfAccessToken) throw new Error("অ্যাকাউন্ট সংযোগ পাওয়া যায়নি।");
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (sessionError || !accessToken) throw new Error("সেশন শেষ হয়েছে। আবার sign in করো।");
    const response = await fetch("https://creovanta-api.onrender.com/api/v1/speech/voices/status", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "X-HF-Token": hfAccessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ voice_profile_id: profileId, status }),
    });
    if (!response.ok) {
      let detail = "Voice Profile status update failed (HTTP " + response.status + ")";
      try { const body = await response.json(); detail = body.detail || detail; } catch {}
      throw new Error(detail);
    }
  }

  async function audioDurationSeconds(file: File): Promise<number> {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise<number>((resolve, reject) => {
        const audio = new Audio();
        audio.preload = "metadata";
        audio.onloadedmetadata = () => resolve(audio.duration);
        audio.onerror = () => reject(new Error("অডিও ফাইলটি পড়া যাচ্ছে না।"));
        audio.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function disconnectGenerationAccount() {
    setHfAccessToken("");
    setHfUsername("");
    setMessage("Generation account disconnected from this browser session.");
  }

  async function authenticate() {
    if (!supabase) { setMessage("Supabase is not configured yet."); return; }
    if (!email.trim() || password.length < 8) {
      setMessage("Enter a valid email and a password with at least 8 characters.");
      return;
    }
    setBusy(true);
    setMessage("");
    const result = mode === "signup"
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else if (mode === "signup" && !result.data.session) {
      setMessage("Account created. Check your email to confirm your address, then sign in.");
    } else {
      setUser(result.data.user);
      setMessage("You are signed in.");
    }
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setProfiles([]);
    setHfAccessToken("");
    setHfUsername("");
    setMessage("You have signed out.");
  }

  async function deleteAccount() {
    if (!supabase || !user) return;
    const confirmed = window.confirm("Delete your Creovanta account, voice profiles, and uploaded voice samples permanently? This cannot be undone.");
    if (!confirmed) return;
    setBusy(true);
    setMessage("Deleting your account and private voice data…");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (sessionError || !accessToken) throw new Error("Your session has expired. Sign in again and retry.");
      const response = await fetch("https://creovanta-api.onrender.com/api/v1/account", {
        method: "DELETE",
        headers: { "Authorization": "Bearer " + accessToken },
      });
      if (!response.ok) {
        let detail = "Account deletion failed (HTTP " + response.status + ").";
        try { const body = await response.json(); detail = body.detail || detail; } catch {}
        throw new Error(detail);
      }
      const records = await getAudioRecords(user.id).catch(() => []);
      for (const record of records) await removeAudioRecord(record.id).catch(() => undefined);
      audioHistory.forEach(item => URL.revokeObjectURL(item.url));
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      await supabase.auth.signOut();
      setUser(null);
      setProfiles([]);
      setAudioHistory([]);
      setAudioUrl("");
      setHfAccessToken("");
      setHfUsername("");
      setMessage("তোমার Creovanta account এবং ব্যক্তিগত voice sample মুছে ফেলা হয়েছে।");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Account deletion could not be completed. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    return () => { if (audioUrl) URL.revokeObjectURL(audioUrl); };
  }, [audioUrl]);

  useEffect(() => {
    if (!user) { setAudioHistory([]); return; }
    let cancelled = false;
    getAudioRecords(user.id).then(records => {
      if (cancelled) return;
      setAudioHistory(records.map(record => ({ id: record.id, text: record.text, createdAt: record.createdAt, url: URL.createObjectURL(record.blob), extension: record.contentType.includes("mpeg") ? "mp3" : "wav" })));
    }).catch(() => setHistoryMessage("এই ডিভাইসে অডিও হিস্ট্রি লোড করা যায়নি।"));
    return () => { cancelled = true; };
  }, [user?.id]);

  async function deleteHistoryItem(id: string) {
    try {
      const item = audioHistory.find(entry => entry.id === id);
      if (item) URL.revokeObjectURL(item.url);
      await removeAudioRecord(id);
      setAudioHistory(current => current.filter(item => item.id !== id));
      setHistoryMessage("অডিও হিস্ট্রি থেকে মুছে ফেলা হয়েছে।");
    } catch { setHistoryMessage("অডিও মুছতে সমস্যা হয়েছে।"); }
  }

  async function generateSpeech() {
    if (!supabase || !user) return;
    const transcript = speechText.trim();
    if (!hfAccessToken) { setMessage("আগে generation account connect করো।"); return; }
    const profile = profiles.find(item => item.id === selectedProfileId);
    if (!profile || profile.status !== "ready" || !profile.reference_text || !profile.source_audio_path) {
      setMessage("আগে প্রস্তুত Voice Profile তৈরি বা নির্বাচন করুন।");
      return;
    }
    if (!transcript) { setMessage("বাংলা লেখা লিখুন।"); return; }
    const maxSpeechChars = 1200;
    if (transcript.length > maxSpeechChars) { setMessage("সর্বোচ্চ " + maxSpeechChars + " অক্ষর লেখা যাবে।"); return; }
    setGenerating(true);
    setMessage("তোমার কণ্ঠে অডিও তৈরি হচ্ছে… প্রথমবার GPU চালু হতে প্রায় এক মিনিট লাগতে পারে।");
    try {
      const sample = await supabase.storage.from(BUCKET).download(profile.source_audio_path);
      if (sample.error || !sample.data) throw new Error("ব্যক্তিগত voice sample পাওয়া যায়নি। আবার upload করো।");
      const generated = await runMayaClone(transcript, sample.data, profile.reference_text, profile.language_code || "bn");
      const blob = generated.blob;
      const contentType = generated.contentType;
      const extension = contentType.includes("mpeg") ? "mp3" : "wav";
      const nextUrl = URL.createObjectURL(new Blob([blob], { type: contentType }));
      setAudioExtension(extension);
      setAudioUrl(nextUrl);
      const record: AudioHistoryItem = { id: crypto.randomUUID(), userId: user.id, text: transcript, createdAt: new Date().toISOString(), contentType, blob };
      try {
        await saveAudioRecord(record);
        setAudioHistory(current => [{ id: record.id, text: transcript, createdAt: record.createdAt, url: URL.createObjectURL(blob), extension }, ...current]);
        setHistoryMessage("এই ডিভাইসে অডিওটি হিস্ট্রিতে সংরক্ষিত হয়েছে।");
      } catch {
        setHistoryMessage("অডিও তৈরি হয়েছে, তবে ডিভাইসের স্টোরেজে হিস্ট্রি সংরক্ষণ করা যায়নি।");
      }
      setMessage("অডিও তৈরি হয়েছে। নিচে শুনতে ও ডাউনলোড করতে পারো।");
    } catch (error) {
      const message = error instanceof Error ? error.message : "অজানা সমস্যায় অডিও তৈরি হয়নি।";
      setMessage(message);
    } finally {
      setGenerating(false);
    }
  }

  async function retryVoiceClone(profileId: string) {
    if (!supabase) return;
    const profile = profiles.find(item => item.id === profileId);
    if (!profile?.source_audio_path) {
      setMessage("এই Profile-এর private sample পাওয়া যাচ্ছে না। নতুন অডিও upload করো।");
      return;
    }
    setBusy(true);
    setMessage("Voice Profile আবার তৈরি হচ্ছে…");
    try {
      const sample = await supabase.storage.from(BUCKET).download(profile.source_audio_path);
      if (sample.error || !sample.data) throw new Error("ব্যক্তিগত voice sample পাওয়া যায়নি। নতুন করে upload করো।");
      const transcript = profile.reference_text?.trim() || await transcribeAudio(sample.data);
      if (!profile.reference_text?.trim()) {
        const saved = await supabase.from("voice_profiles").update({ reference_text: transcript }).eq("id", profileId);
        if (saved.error) throw new Error("স্বয়ংক্রিয় transcript সংরক্ষণ করা যায়নি: " + saved.error.message);
      }
      const preview = await runMayaClone("আমার কণ্ঠে বাংলা অডিও পরীক্ষা করা হচ্ছে।", sample.data, transcript, profile.language_code || "bn");
      await updateVoiceProfileStatus(profileId, "ready");
      if (clonePreviewUrl) URL.revokeObjectURL(clonePreviewUrl);
      setClonePreviewUrl(URL.createObjectURL(preview.blob));
      await loadProfiles(profileId);
      setMessage("Voice Profile প্রস্তুত। এখন Text-to-Speech ব্যবহার করতে পারো।");
    } catch (error) {
      await updateVoiceProfileStatus(profileId, "failed").catch(() => undefined);
      await loadProfiles();
      setMessage(error instanceof Error ? error.message : "Voice cloning সম্পন্ন হয়নি। পরে আবার চেষ্টা করো।");
    } finally {
      setBusy(false);
    }
  }

  async function uploadVoice() {
    if (busy) return;
    setMessage("নমুনা যাচাই করা হচ্ছে…");
    if (!supabase || !user) { setMessage("অ্যাকাউন্টে আবার sign in করো।"); return; }
    if (!voiceName.trim()) { setMessage("Voice profile-এর একটি নাম লিখুন।"); return; }
    if (!hfAccessToken) { setMessage("আগে generation account connect করো।"); return; }
    if (!audioFile) { setMessage("আগে একটি অডিও ফাইল নির্বাচন করুন।"); return; }
    if (!consentAccepted) { setMessage("কণ্ঠের মালিকানা ও অনুমতির ঘরে সম্মতি দিন।"); return; }
    if (audioFile.size > MAX_FILE_BYTES) { setMessage("অডিও ফাইল ৫০ MB বা তার কম হতে হবে।"); return; }
    if (!ACCEPTED_TYPES.includes(audioFile.type)) {
      setMessage("WAV, MP3, FLAC অথবা OGG অডিও ফাইল ব্যবহার করুন।");
      return;
    }

    setBusy(true);
    try {
      const seconds = await audioDurationSeconds(audioFile);
      if (!Number.isFinite(seconds) || seconds < 3 || seconds > 10) {
        throw new Error("৩–১০ সেকেন্ডের পরিষ্কার voice sample ব্যবহার করুন।");
      }

      const transcript = referenceTranscript.trim();
      if (!transcript) throw new Error("Reference Transcript লিখুন—অডিওতে যা বলা হয়েছে ঠিক সেটাই লিখবেন।");
      if (!voiceDescription.trim()) throw new Error("Voice Description ঘরটি পূরণ করুন.");

      setMessage("ব্যক্তিগত voice sample আপলোড হচ্ছে…");
      const extension = audioFile.name.split(".").pop()?.toLowerCase() || "audio";
      const objectPath = user.id + "/" + crypto.randomUUID() + "." + extension;
      const upload = await supabase.storage.from(BUCKET).upload(objectPath, audioFile, {
        contentType: audioFile.type,
        upsert: false,
      });
      if (upload.error) throw new Error("Upload failed: " + upload.error.message);

      const profile = await supabase.from("voice_profiles").insert({
        user_id: user.id,
        name: voiceName.trim(),
        description: voiceDescription.trim() || null,
        language_code: "bn",
        reference_text: transcript,
        source_audio_path: objectPath,
        consent_type: consentType,
        status: "processing",
      }).select("id").single();

      if (profile.error || !profile.data) {
        await supabase.storage.from(BUCKET).remove([objectPath]);
        throw new Error("Voice Profile সংরক্ষণ করা যায়নি: " + (profile.error?.message ?? "Unknown error"));
      }

      const consent = await supabase.from("voice_consents").insert({
        user_id: user.id,
        voice_profile_id: profile.data.id,
        consent_type: consentType,
        consent_text_version: "creovanta-consent-v3",
        accepted: true,
      });

      if (consent.error) {
        await supabase.from("voice_profiles").delete().eq("id", profile.data.id);
        await supabase.storage.from(BUCKET).remove([objectPath]);
        throw new Error("সম্মতির তথ্য সংরক্ষণ করা যায়নি: " + consent.error.message);
      }

      try {
        setMessage("নমুনা সংরক্ষিত। এখন Voice Profile তৈরি হচ্ছে…");
        const preview = await runMayaClone("আমার কণ্ঠে বাংলা অডিও পরীক্ষা করা হচ্ছে।", audioFile, transcript, "bn");
        await updateVoiceProfileStatus(profile.data.id, "ready");
        if (clonePreviewUrl) URL.revokeObjectURL(clonePreviewUrl);
        setClonePreviewUrl(URL.createObjectURL(preview.blob));
      } catch (error) {
        await updateVoiceProfileStatus(profile.data.id, "failed").catch(() => undefined);
        await loadProfiles(profile.data.id);
        throw new Error("নমুনা ও সম্মতি সংরক্ষিত হয়েছে, কিন্তু ভয়েস ক্লোন তৈরি হয়নি। " + (error instanceof Error ? error.message : ""));
      }

      setVoiceName("");
      setVoiceDescription(DEFAULT_VOICE_DESCRIPTION);
      setAudioFile(null);
      setConsentAccepted(false);
      const input = document.getElementById("voice-audio") as HTMLInputElement | null;
      if (input) input.value = "";
      await loadProfiles(profile.data.id);
      setMessage("Creovanta Voice Profile প্রস্তুত। এখন বাংলা Text-to-Speech ব্যবহার করতে পারো।");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "নমুনা সংরক্ষণ করা যায়নি। আবার চেষ্টা করো।");
    } finally {
      setBusy(false);
    }
  }

  const bars = [18,32,48,26,62,84,45,28,70,94,58,34,76,50,22,64,86,42,26,56,72,38,18,48,66,30,52,82,40,20,60,34,76,46,24,58,88,42,18,50];

  return <main>
    <div className="wrap">
      <nav className="nav">
        <a className="brand" href="#"><span className="logo">C</span> Creovanta</a>
        <div className="navlinks">
          <a href="#features">Features</a><a href="#safety">Safety</a>
          {user ? <button className="btn secondary" onClick={signOut}><LogOut size={15} style={{verticalAlign:"middle",marginRight:6}}/>Sign out</button> : <a className="btn" href="#account">Get started</a>}
        </div>
      </nav>

      <section className="hero">
        <div>
          <div className="eyebrow">Your voice. Your AI.</div>
          <h1>Give your words<br/>a <span className="grad">voice of their own.</span></h1>
          <p className="lead">Create expressive, natural-sounding speech with a voice that belongs to you. Record once, build your voice library, and bring your words to life.</p>
          <div style={{display:"flex",gap:12,marginTop:28,flexWrap:"wrap"}}>
            <a className="btn" href="#account" style={{display:"inline-flex",alignItems:"center",gap:9}}>Create your account <ArrowRight size={17}/></a>
            <a className="btn secondary" href="#features">Explore features</a>
          </div>
          <p className="small" style={{marginTop:18}}>Voice cloning is restricted to your own voice or voices you have explicit permission to use.</p>
        </div>
        <div className="heroCard">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span className="small">VOICE STUDIO</span><span className="small" style={{color:"#7bd9c6"}}>● PRIVATE WORKSPACE</span></div>
          <div style={{padding:"24px 0 8px",display:"flex",alignItems:"center",gap:12}}><div className="icon"><AudioLines/></div><div><b style={{fontSize:15}}>Your Voice Library</b><div className="small">Private voice profiles and samples</div></div></div>
          <div className="wave">{bars.map((h,i)=><i key={i} style={{"--h":h+"px"} as React.CSSProperties}/>)}</div>
          <div style={{display:"flex",justifyContent:"space-between"}}><span className="small">Waveform preview</span><span className="small">Private by default</span></div>
        </div>
      </section>

      <section id="features" className="features">
        <div className="feature"><div className="icon"><Mic2/></div><h3>Voice Library</h3><p>Keep your permitted voice profiles organized in one private workspace.</p></div>
        <div className="feature"><div className="icon"><WandSparkles/></div><h3>Natural Speech</h3><p>Turn written scripts into expressive audio when a supported speech engine is connected.</p></div>
        <div className="feature" id="safety"><div className="icon"><ShieldCheck/></div><h3>Consent first</h3><p>Voice ownership and explicit permission are required before a sample is saved.</p></div>
      </section>

      <section id="account" className="panel" style={{maxWidth:760,margin:"0 auto 34px",padding:30}}>
        <div className="eyebrow">Your workspace</div>
        <h2>{user ? "Welcome to Creovanta" : "Start creating with your voice"}</h2>
        {!user ? <>
          <p className="small" style={{marginBottom:18}}>Create an account or sign in to continue.</p>
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            <button className={"btn "+(mode==="signup"?"":"secondary")} onClick={()=>setMode("signup")}>Sign up</button>
            <button className={"btn "+(mode==="login"?"":"secondary")} onClick={()=>setMode("login")}>Sign in</button>
          </div>
          <label>Email address</label><input className="field" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/>
          <label>Password</label><input className="field" type="password" autoComplete={mode==="signup"?"new-password":"current-password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/>
          <button className="btn" style={{width:"100%"}} onClick={authenticate} disabled={busy}>{busy?"Please wait…":mode==="signup"?"Create account":"Sign in"}</button>
        </> : <>
          <p className="lead" style={{fontSize:14}}>Signed in as {user.email}</p>
          <div className="status">Your account is connected. Add a voice sample below. Uploads are private and restricted to your account.</div>
          <div className="feature" style={{padding:16,marginBottom:18}}>
            <b>Creovanta Speech Studio</b>
            <p className="small" style={{margin:"8px 0 12px"}}>{hfAccessToken ? "Connected as " + hfUsername + ". Your own free daily GPU quota is used; the token stays only in this open page and is cleared on refresh. Creovanta does not store it." : "Connect your generation account to enable your personal daily processing allowance. No payment card is required."}</p>
            {hfAccessToken ? <button className="btn secondary" onClick={disconnectGenerationAccount}>Disconnect generation account</button> : <button className="btn" onClick={connectGenerationAccount}>Connect generation account</button>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14}}>
            <div><label>Voice profile name</label><input className="field" value={voiceName} onChange={e=>setVoiceName(e.target.value)} placeholder="e.g. My Bengali Voice"/></div>
            <div><label>Voice ownership</label><select className="field" value={consentType} onChange={e=>setConsentType(e.target.value as "self"|"authorized")}><option value="self">This is my own voice</option><option value="authorized">I have explicit permission</option></select></div>
          </div>
          <label>Voice Description (required)</label><textarea className="field" rows={2} required value={voiceDescription} onChange={e=>setVoiceDescription(e.target.value)} placeholder="Describe the natural voice style" style={{resize:"vertical",lineHeight:1.6}}/>
          <label htmlFor="voice-audio">Audio sample (WAV, MP3, FLAC, OGG · max 50 MB)</label>
          <input id="voice-audio" className="field" type="file" accept=".wav,.mp3,.flac,.ogg,.oga,audio/wav,audio/mpeg,audio/flac,audio/ogg" onChange={e=>setAudioFile(e.target.files?.[0] ?? null)}/>
          <p className="small" style={{marginTop:8,marginBottom:12}}>Maya-এর reference voice নিয়ম অনুযায়ী ৩–১০ সেকেন্ডের পরিষ্কার বাংলা অডিও দিন। ১০ সেকেন্ডের বেশি হলে ছোট করে কাটুন এবং Transcript-এ শুধু ওই অংশের কথাগুলো লিখুন।</p>
          <label>Reference Transcript (required)</label>
          <textarea className="field" rows={3} required value={referenceTranscript} onChange={e=>setReferenceTranscript(e.target.value)} placeholder="অডিওতে যা বলা হয়েছে ঠিক সেটাই এখানে লিখুন…" style={{resize:"vertical",lineHeight:1.7}}/>
          <p className="small" style={{marginTop:6,marginBottom:12}}>অডিওতে বলা কথাগুলো হুবহু লিখুন। ভুল বা অসম্পূর্ণ Transcript হলে কণ্ঠের মিল কমতে পারে।</p>
          <p className="small" style={{margin:"12px 0 8px"}}>গুরুত্বপূর্ণ: voice cloning-এর জন্য নমুনা অডিও ও আপনার দেওয়া Transcript Hugging Face-এর Maya speech processing service-এ পাঠানো হবে। বাইরের service-এর retention Creovanta সরাসরি নিয়ন্ত্রণ করে না.</p>
          <label style={{display:"flex",alignItems:"flex-start",gap:10,margin:"10px 0 18px",lineHeight:1.5}}>
            <input type="checkbox" checked={consentAccepted} onChange={e=>setConsentAccepted(e.target.checked)} style={{marginTop:3}}/>
            আমি নিশ্চিত করছি এটি আমার নিজের কণ্ঠ অথবা কণ্ঠের মালিকের স্পষ্ট অনুমতি আছে। আমি নমুনা অডিও ও আমার দেওয়া Transcript voice cloning-এর জন্য পাঠাতে সম্মত.
          </label>
          <button className="btn" style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:9}} onClick={uploadVoice} disabled={busy}><UploadCloud size={17}/>{busy ? "Maya-তে Voice Clone চলছে…" : "Voice Clone"}</button>
          {message && <div className="status" role="status" aria-live="polite" style={{marginTop:12,whiteSpace:"pre-wrap"}}>{message}</div>}
          <div style={{marginTop:28,borderTop:"1px solid #293044",paddingTop:22}}>
            <h3 style={{fontSize:20,letterSpacing:"-.5px"}}>Creovanta বাংলা Text-to-Speech</h3>
            <p className="small" style={{marginBottom:14}}>তোমার অনুমোদিত voice profile ব্যবহার করে বাংলা লেখা থেকে অডিও তৈরি করো। সর্বোচ্চ ১২০০ অক্ষর।</p>
            <label>মালিকানা যাচাইয়ের Voice Profile</label>
            <select className="field" value={selectedProfileId} onChange={e=>setSelectedProfileId(e.target.value)} disabled={profiles.length===0}>
              {profiles.filter(profile=>profile.status==="ready" && profile.reference_text && profile.source_audio_path).length===0 ? <option value="">আগে একটি প্রস্তুত Voice Profile তৈরি করো</option> : profiles.map(profile=><option key={profile.id} value={profile.id} disabled={profile.status!=="ready" || !profile.reference_text || !profile.source_audio_path}>{profile.name} · {profile.status==="ready"?"প্রস্তুত":profile.status==="processing"?"প্রসেসিং":"আবার নমুনা প্রয়োজন"}</option>)}
            </select>
            <label>যে বাংলা লেখা বলাতে চাও</label>
            <textarea className="field" rows={5} maxLength={1200} value={speechText} onChange={e=>setSpeechText(e.target.value)} placeholder="এখানে বাংলা লেখা লিখুন… যেমন: আসসালামু আলাইকুম। ক্রিওভান্তায় আপনাকে স্বাগতম।" style={{resize:"vertical",lineHeight:1.7}} />
            <div className="small" style={{textAlign:"right",marginTop:-8,marginBottom:14}}>{speechText.length}/{1200}</div>
            <button className="btn" style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:9}} onClick={generateSpeech} disabled={generating || !profiles.some(profile=>profile.status==="ready" && profile.reference_text && profile.source_audio_path) || !speechText.trim()}><AudioLines size={17}/>{generating?"অডিও তৈরি হচ্ছে…":"অডিও তৈরি করুন"}</button>
            {audioUrl && <div className="feature" style={{marginTop:16,padding:16}}>
              <b>তোমার তৈরি অডিও</b>
              <audio controls src={audioUrl} style={{width:"100%",marginTop:12}} />
              <a className="btn secondary" href={audioUrl} download={"creovanta-bengali-voice." + audioExtension} style={{display:"inline-block",marginTop:12}}>অডিও ডাউনলোড</a>
            </div>}
          </div>
          <div style={{marginTop:28,borderTop:"1px solid #293044",paddingTop:22}}>
            <h3 style={{fontSize:20,letterSpacing:"-.5px"}}>অডিও হিস্ট্রি</h3>
            <p className="small" style={{marginBottom:14}}>তৈরি করা অডিও এই ডিভাইসের ব্রাউজারে সংরক্ষিত থাকবে। অন্য ডিভাইসে দেখা যাবে না।</p>
            {historyMessage && <div className="small" role="status" style={{marginBottom:12}}>{historyMessage}</div>}
            {audioHistory.length===0 ? <p className="small">এখনো কোনো অডিও সংরক্ষিত হয়নি।</p> : <div style={{display:"grid",gap:12}}>
              {audioHistory.map(item=><div key={item.id} className="feature" style={{padding:16}}>
                <div className="small">{new Date(item.createdAt).toLocaleString()}</div>
                <p style={{lineHeight:1.6,margin:"8px 0",whiteSpace:"pre-wrap"}}>{item.text}</p>
                <audio controls src={item.url} style={{width:"100%"}} />
                <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:10}}>
                  <a className="btn secondary" href={item.url} download={"creovanta-audio."+item.extension}>ডাউনলোড</a>
                  <button className="btn secondary" onClick={()=>deleteHistoryItem(item.id)}>মুছে ফেলুন</button>
                </div>
              </div>)}
            </div>}
          </div>
          <div style={{marginTop:28,borderTop:"1px solid #293044",paddingTop:22}}>
            <h3 style={{fontSize:20,letterSpacing:"-.5px"}}>Your Voice Library</h3>
            {profiles.length===0 ? <p className="small">No voice profiles saved yet.</p> : <div style={{display:"grid",gap:10}}>
              {profiles.map(profile=><div key={profile.id} className="feature" style={{padding:16,display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}>
                <div><b>{profile.name}</b><div className="small">{profile.description || "Bengali voice sample"} · {new Date(profile.created_at).toLocaleDateString()}</div></div>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <span className="small">{profile.status==="ready"?"প্রস্তুত":profile.status==="processing"?"প্রসেসিং":profile.status==="failed"?"ব্যর্থ":"অপেক্ষমাণ"}</span>
                  {profile.status!=="ready" && profile.source_audio_path && <button className="btn secondary" disabled={busy} onClick={()=>retryVoiceClone(profile.id)}>আবার চেষ্টা</button>}
                </div>
              </div>)}
            </div>}
          </div>
          <div className="feature" style={{marginTop:24,padding:18}}>
            <h3 style={{fontSize:18,letterSpacing:"-.5px"}}>Account & Privacy</h3>
            <p>তুমি চাইলে তোমার Creovanta account, voice profiles এবং private uploaded samples স্থায়ীভাবে মুছে ফেলতে পারো।</p>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
              <a className="btn secondary" href="/privacy">Privacy Policy</a>
              <a className="btn secondary" href="/delete-account">Delete account help</a>
              <button className="btn secondary" onClick={deleteAccount} disabled={busy}>Delete my account</button>
            </div>
          </div>
        </>}
        {message && <div className="status" role="status">{message}</div>}
      </section>
      {clonePreviewUrl && <div role="dialog" aria-modal="true" aria-label="Voice clone preview" style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(5,8,18,.82)",display:"grid",placeItems:"center",padding:18}}>
        <div className="panel" style={{width:"min(100%,520px)",padding:24,position:"relative",boxShadow:"0 24px 90px rgba(0,0,0,.45)"}}>
          <button className="btn secondary" aria-label="Close preview" onClick={()=>{URL.revokeObjectURL(clonePreviewUrl);setClonePreviewUrl("");}} style={{position:"absolute",right:14,top:14,width:40,height:40,padding:0,display:"grid",placeItems:"center"}}><X size={19}/></button>
          <div className="icon" style={{marginBottom:16}}><AudioLines/></div>
          <h2 style={{margin:"0 42px 8px 0"}}>Voice cloned successfully</h2>
          <p className="small" style={{marginBottom:20}}>তোমার কণ্ঠের Preview শুনে দেখো। বন্ধ করলেও Voice Profile তোমার Library-তে থাকবে।</p>
          <audio controls autoPlay src={clonePreviewUrl} style={{width:"100%"}} />
          <button className="btn" onClick={()=>{URL.revokeObjectURL(clonePreviewUrl);setClonePreviewUrl("");}} style={{width:"100%",marginTop:18}}>Done</button>
        </div>
      </div>}
      <footer className="footer" style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><span>© {new Date().getFullYear()} Creovanta</span><span style={{display:"flex",gap:14,flexWrap:"wrap"}}><a href="/privacy">Privacy Policy</a><a href="/delete-account">Delete account</a><span>Creovanta Voice Cloning · Your voice, your creation.</span></span></footer>
    </div>
  </main>;
}

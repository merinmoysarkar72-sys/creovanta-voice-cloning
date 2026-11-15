"use client";

import { useEffect, useState } from "react";
import { ArrowRight, AudioLines, ShieldCheck, Sparkles, WandSparkles, Mic2, UploadCloud, LogOut } from "lucide-react";
import { createClient, SupabaseClient, User } from "@supabase/supabase-js";


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
  created_at: string;
};

const BUCKET = "voice-samples";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ACCEPTED_TYPES = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/webm", "audio/flac"];

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
  const [voiceDescription, setVoiceDescription] = useState("");
  const [consentType, setConsentType] = useState<"self" | "authorized">("self");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [speechText, setSpeechText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioExtension, setAudioExtension] = useState("wav");
  const [audioHistory, setAudioHistory] = useState<Array<{id:string;text:string;createdAt:string;url:string;extension:string}>>([]);
  const [historyMessage, setHistoryMessage] = useState("");

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

  async function loadProfiles() {
    if (!supabase || !user) return;
    const { data, error } = await supabase
      .from("voice_profiles")
      .select("id,name,description,language_code,status,consent_type,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) setMessage("Could not load your voice library: " + error.message);
    else {
      const nextProfiles = (data ?? []) as VoiceProfile[];
      setProfiles(nextProfiles);
      setSelectedProfileId((current) => current || nextProfiles[0]?.id || "");
    }
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
    setMessage("You have signed out.");
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
    if (!selectedProfileId) { setMessage("আগে Voice Library থেকে একটি voice profile নির্বাচন করুন।"); return; }
    if (!transcript) { setMessage("বাংলা লেখা লিখুন।"); return; }
    if (transcript.length > 2000) { setMessage("সর্বোচ্চ ২০০০ অক্ষর লেখা যাবে।"); return; }
    setGenerating(true);
    setMessage("তোমার ক্লোন করা কণ্ঠে অডিও তৈরি হচ্ছে…");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (sessionError || !accessToken) throw new Error("সেশন শেষ হয়েছে। আবার sign in করো।");
      const response = await fetch("https://creovanta-api.onrender.com/api/v1/tts", {
        method: "POST",
        headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ voice_profile_id: selectedProfileId, text: transcript }),
      });
      if (!response.ok) {
        let detail = "অডিও তৈরি হয়নি (HTTP " + response.status + ")";
        try { const body = await response.json(); detail = body.detail || detail; } catch {}
        throw new Error(detail);
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("সার্ভার খালি অডিও পাঠিয়েছে।");
      const contentType = response.headers.get("content-type") || blob.type;
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
      setMessage(error instanceof Error ? error.message : "অজানা সমস্যায় অডিও তৈরি হয়নি।");
    } finally {
      setGenerating(false);
    }
  }

  async function requestVoiceClone(profileId: string) {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (sessionError || !accessToken) throw new Error("সেশন শেষ হয়েছে। আবার sign in করো।");
    const response = await fetch("https://creovanta-api.onrender.com/api/v1/voices/clone", {
      method: "POST",
      headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ voice_profile_id: profileId }),
    });
    if (!response.ok) {
      let detail = "Voice cloning failed (HTTP " + response.status + ")";
      try { const body = await response.json(); detail = body.detail || detail; } catch {}
      throw new Error(detail);
    }
  }

  async function retryVoiceClone(profileId: string) {
    setBusy(true);
    setMessage("তোমার Voice Profile তৈরি হচ্ছে…");
    try {
      await requestVoiceClone(profileId);
      await loadProfiles();
      setMessage("Voice Profile প্রস্তুত। এখন বাংলা Text-to-Speech ব্যবহার করতে পারো।");
    } catch (error) {
      await loadProfiles();
      setMessage(error instanceof Error ? error.message : "Voice cloning সম্পন্ন হয়নি। পরে আবার চেষ্টা করো।");
    } finally {
      setBusy(false);
    }
  }

  async function uploadVoice() {
    if (!supabase || !user) return;
    if (!voiceName.trim()) { setMessage("Give this voice profile a name."); return; }
    if (!audioFile) { setMessage("Choose an audio file first."); return; }
    if (!consentAccepted) { setMessage("You must confirm voice ownership or explicit permission."); return; }
    if (audioFile.size > MAX_FILE_BYTES) { setMessage("The audio file must be 50 MB or smaller."); return; }
    if (!ACCEPTED_TYPES.includes(audioFile.type)) {
      setMessage("Use a WAV, MP3, M4A, WebM, or FLAC audio file.");
      return;
    }

    setBusy(true);
    setMessage("Uploading your private voice sample…");
    const extension = audioFile.name.split(".").pop()?.toLowerCase() || "audio";
    const objectPath = user.id + "/" + crypto.randomUUID() + "." + extension;
    const upload = await supabase.storage.from(BUCKET).upload(objectPath, audioFile, {
      contentType: audioFile.type,
      upsert: false,
    });
    if (upload.error) {
      setBusy(false);
      setMessage("Upload failed: " + upload.error.message);
      return;
    }

    const profile = await supabase.from("voice_profiles").insert({
      user_id: user.id,
      name: voiceName.trim(),
      description: voiceDescription.trim() || null,
      language_code: "bn",
      source_audio_path: objectPath,
      consent_type: consentType,
      status: "processing",
    }).select("id").single();

    if (profile.error || !profile.data) {
      await supabase.storage.from(BUCKET).remove([objectPath]);
      setBusy(false);
      setMessage("Could not save the voice profile: " + (profile.error?.message ?? "Unknown error"));
      return;
    }

    const consent = await supabase.from("voice_consents").insert({
      user_id: user.id,
      voice_profile_id: profile.data.id,
      consent_type: consentType,
      consent_text_version: "creovanta-consent-v1",
      accepted: true,
    });

    if (consent.error) {
      await supabase.from("voice_profiles").delete().eq("id", profile.data.id);
      await supabase.storage.from(BUCKET).remove([objectPath]);
      setBusy(false);
      setMessage("The consent record could not be saved, so the upload was rolled back: " + consent.error.message);
      return;
    }

    try {
      await requestVoiceClone(profile.data.id);
    } catch (error) {
      await loadProfiles();
      setBusy(false);
      setMessage("নমুনা ও সম্মতি সংরক্ষিত হয়েছে, কিন্তু ভয়েস ক্লোন তৈরি হয়নি। Voice Library থেকে আবার চেষ্টা করো। " + (error instanceof Error ? error.message : ""));
      return;
    }

    setVoiceName("");
    setVoiceDescription("");
    setAudioFile(null);
    setConsentAccepted(false);
    const input = document.getElementById("voice-audio") as HTMLInputElement | null;
    if (input) input.value = "";
    await loadProfiles();
    setBusy(false);
    setMessage("Creovanta Voice Profile প্রস্তুত। এখন এই Profile দিয়ে বাংলা Text-to-Speech ব্যবহার করতে পারো।");
  }

  const bars = [18,32,48,26,62,84,45,28,70,94,58,34,76,50,22,64,86,42,26,56,72,38,18,48,66,30,52,82,40,20,60,34,76,46,24,58,88,42,18,50];

  return <main>
    <div className="wrap">
      <nav className="nav">
        <a className="brand" href="#"><span className="logo">C</span> creovanta</a>
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
          <div style={{borderTop:"1px solid #293044",marginTop:24,paddingTop:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span className="small">Speech engine</span><span className="small">Creovanta Voice Cloning · audio generation tested</span></div>
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
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14}}>
            <div><label>Voice profile name</label><input className="field" value={voiceName} onChange={e=>setVoiceName(e.target.value)} placeholder="e.g. My Bengali Voice"/></div>
            <div><label>Voice ownership</label><select className="field" value={consentType} onChange={e=>setConsentType(e.target.value as "self"|"authorized")}><option value="self">This is my own voice</option><option value="authorized">I have explicit permission</option></select></div>
          </div>
          <label>Short description (optional)</label><input className="field" value={voiceDescription} onChange={e=>setVoiceDescription(e.target.value)} placeholder="Voice style or notes"/>
          <label htmlFor="voice-audio">Audio sample (WAV, MP3, M4A, WebM, FLAC · max 50 MB)</label>
          <input id="voice-audio" className="field" type="file" accept=".wav,.mp3,.m4a,.webm,.flac,audio/*" onChange={e=>setAudioFile(e.target.files?.[0] ?? null)}/>
          <label style={{display:"flex",alignItems:"flex-start",gap:10,margin:"10px 0 18px",lineHeight:1.5}}>
            <input type="checkbox" checked={consentAccepted} onChange={e=>setConsentAccepted(e.target.checked)} style={{marginTop:3}}/>
            I confirm this is my voice or I have explicit permission from the voice owner to upload and use it for AI voice generation.
          </label>
          <button className="btn" style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:9}} onClick={uploadVoice} disabled={busy}><UploadCloud size={17}/>{busy?"Please wait…":"Save private voice sample"}</button>
          <div style={{marginTop:28,borderTop:"1px solid #293044",paddingTop:22}}>
            <h3 style={{fontSize:20,letterSpacing:"-.5px"}}>Creovanta বাংলা Text-to-Speech</h3>
            <p className="small" style={{marginBottom:14}}>Creovanta Voice Cloning-এ তোমার নিজের ক্লোন করা কণ্ঠে বাংলা লেখা থেকে অডিও তৈরি করো। নির্বাচিত Voice Profile দিয়ে মালিকানা ও সম্মতি যাচাই হবে। সর্বোচ্চ ২০০০ অক্ষর।</p>
            <label>মালিকানা যাচাইয়ের Voice Profile</label>
            <select className="field" value={selectedProfileId} onChange={e=>setSelectedProfileId(e.target.value)} disabled={profiles.length===0}>
              {profiles.length===0 ? <option value="">আগে Voice Library-তে voice sample যোগ করো</option> : profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
            <label>যে বাংলা লেখা বলাতে চাও</label>
            <textarea className="field" rows={5} maxLength={2000} value={speechText} onChange={e=>setSpeechText(e.target.value)} placeholder="এখানে বাংলা লেখা লিখুন… যেমন: আসসালামু আলাইকুম। ক্রিওভান্তায় আপনাকে স্বাগতম।" style={{resize:"vertical",lineHeight:1.7}} />
            <div className="small" style={{textAlign:"right",marginTop:-8,marginBottom:14}}>{speechText.length}/2000</div>
            <button className="btn" style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:9}} onClick={generateSpeech} disabled={generating || !profiles.length || !speechText.trim()}><AudioLines size={17}/>{generating?"অডিও তৈরি হচ্ছে…":"অডিও তৈরি করুন"}</button>
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
                  {profile.status!=="ready" && <button className="btn secondary" disabled={busy} onClick={()=>retryVoiceClone(profile.id)}>আবার চেষ্টা</button>}
                </div>
              </div>)}
            </div>}
          </div>
        </>}
        {message && <div className="status" role="status">{message}</div>}
      </section>
      <footer className="footer" style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><span>© {new Date().getFullYear()} Creovanta</span><span>Creovanta Voice Cloning · Your voice, your creation.</span></footer>
    </div>
  </main>;
}

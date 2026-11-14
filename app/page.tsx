"use client";

import { useEffect, useState } from "react";
import { ArrowRight, AudioLines, ShieldCheck, Sparkles, WandSparkles, Mic2 } from "lucide-react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export default function Home() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key) {
      const client = createClient(url, key);
      setSupabase(client);
      client.auth.getSession().then(({ data }) => setSessionEmail(data.session?.user.email ?? null));
      const { data: listener } = client.auth.onAuthStateChange((_event, session) => setSessionEmail(session?.user.email ?? null));
      return () => listener.subscription.unsubscribe();
    }
  }, []);

  async function authenticate() {
    if (!supabase) { setMessage("Authentication is being configured. Please check back soon."); return; }
    if (!email || password.length < 8) { setMessage("Enter a valid email and a password with at least 8 characters."); return; }
    setBusy(true); setMessage("");
    const result = mode === "signup"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else if (mode === "signup" && !result.data.session) setMessage("Account created. Check your email to confirm your address.");
    else setMessage("You are signed in.");
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setSessionEmail(null);
  }

  const bars = [18,32,48,26,62,84,45,28,70,94,58,34,76,50,22,64,86,42,26,56,72,38,18,48,66,30,52,82,40,20,60,34,76,46,24,58,88,42,18,50];
  return <main>
    <div className="wrap">
      <nav className="nav">
        <a className="brand" href="#"><span className="logo">C</span> creovanta</a>
        <div className="navlinks"><a href="#features">Features</a><a href="#safety">Safety</a>{sessionEmail ? <button className="btn secondary" onClick={signOut}>Sign out</button> : <a className="btn" href="#account">Get started</a>}</div>
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
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span className="small">VOICE STUDIO PREVIEW</span><span className="small" style={{color:"#7bd9c6"}}>● READY TO BUILD</span></div>
          <div style={{padding:"24px 0 8px",display:"flex",alignItems:"center",gap:12}}><div className="icon"><AudioLines/></div><div><b style={{fontSize:15}}>Your Voice Library</b><div className="small">A home for your voice profiles</div></div></div>
          <div className="wave">{bars.map((h,i)=><i key={i} style={{"--h":h+"px"} as React.CSSProperties}/>)}</div>
          <div style={{display:"flex",justifyContent:"space-between"}}><span className="small">Voice waveform preview</span><span className="small">00:00</span></div>
          <div style={{borderTop:"1px solid #293044",marginTop:24,paddingTop:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span className="small">Studio workspace</span><span className="small">Coming online in stages</span></div>
        </div>
      </section>
      <section id="features" className="features">
        <div className="feature"><div className="icon"><Mic2/></div><h3>Voice Library</h3><p>Keep your permitted voice profiles organized in one private workspace.</p></div>
        <div className="feature"><div className="icon"><WandSparkles/></div><h3>Natural Speech</h3><p>Turn written scripts into expressive audio as supported speech engines are connected.</p></div>
        <div className="feature" id="safety"><div className="icon"><ShieldCheck/></div><h3>Consent first</h3><p>Voice ownership and explicit permission are central to how Creovanta is designed.</p></div>
      </section>
      <section id="account" className="panel" style={{maxWidth:560,margin:"0 auto 90px",padding:30}}>
        <div className="eyebrow">Your workspace</div>
        <h2>{sessionEmail ? "Welcome to Creovanta" : "Start creating with your voice"}</h2>
        {sessionEmail ? <><p className="lead" style={{fontSize:14}}>Signed in as {sessionEmail}</p><div className="status">Your account is ready. Voice upload and generation will become available after the secure storage and speech engine stages are completed.</div></> : <>
          <p className="small" style={{marginBottom:18}}>Create an account or sign in to continue.</p>
          <div style={{display:"flex",gap:8,marginBottom:16}}><button className={"btn "+(mode==="signup"?"":"secondary")} onClick={()=>setMode("signup")}>Sign up</button><button className={"btn "+(mode==="login"?"":"secondary")} onClick={()=>setMode("login")}>Sign in</button></div>
          <label>Email address</label><input className="field" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/>
          <label>Password</label><input className="field" type="password" autoComplete={mode==="signup"?"new-password":"current-password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/>
          <button className="btn" style={{width:"100%"}} onClick={authenticate} disabled={busy}>{busy?"Please wait…":mode==="signup"?"Create account":"Sign in"}</button>
          {message && <div className="status" role="status">{message}</div>}
          {!supabase && <div className="status">Secure sign-in is being connected. Account creation will activate after the Supabase configuration step.</div>}
        </>}
      </section>
      <footer className="footer" style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><span>© {new Date().getFullYear()} Creovanta</span><span>Built for voices with consent.</span></footer>
    </div>
  </main>;
}

import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Creovanta",
  description: "How Creovanta collects, uses, stores, and shares voice and account data.",
};

export default function PrivacyPolicy() {
  return (
    <main style={{maxWidth:860,margin:"0 auto",padding:"48px 22px",color:"#f4f6fb",lineHeight:1.75}}>
      <p style={{color:"#a997ff",letterSpacing:2,fontSize:12,fontWeight:700}}>CREOVANTA · PRIVACY</p>
      <h1 style={{fontSize:38,margin:"8px 0 4px"}}>Privacy Policy</h1>
      <p style={{color:"#929bb0"}}>Last updated: November 15, 2026</p>
      <p>Creovanta Voice Cloning lets people create speech using a voice they own or have explicit permission to use. This policy explains what information is handled when you use the service.</p>

      <h2>1. Information we handle</h2>
      <ul>
        <li><b>Account information:</b> email address and authentication data needed to create and secure your account. Password authentication is managed by Supabase; Creovanta does not receive your plaintext password.</li>
        <li><b>Voice profile information:</b> profile name, required voice description, language, voice ownership selection, consent record, and the reference transcript entered by the user to match the uploaded recording.</li>
        <li><b>Voice recordings:</b> audio samples you upload for voice cloning. They are stored in a private Supabase Storage bucket associated with your account.</li>
        <li><b>Text and generated audio:</b> the text you submit is sent to Creovanta speech processing for generation. Generated audio history is stored locally in your browser/device unless a future feature clearly says otherwise; it is not currently a cloud audio-history service.</li>
        <li><b>generation account connection:</b> if you connect your generation account, the authorization token is held in the current browser page memory and is not intentionally saved by Creovanta. Refreshing or closing the page clears it.</li>
        <li><b>Technical information:</b> hosting and security services may process IP address, request metadata, device/browser details, and operational logs to deliver and protect the service.</li>
      </ul>

      <h2>2. How we use information</h2>
      <p>We use this information to authenticate users, store and display private voice profiles, verify voice ownership and consent, request speech generation, return audio, maintain service security, and troubleshoot failures.</p>

      <h2>3. Service providers and sharing</h2>
      <ul>
        <li><b>Supabase</b> provides account authentication, database services, and private voice-sample storage.</li>
        <li><b>Vercel</b> hosts the Creovanta web application.</li>
        <li><b>Render</b> hosts the Creovanta API backend.</li>
        <li><b>External speech processing:</b> when you create a voice profile, your reference recording and the transcript you enter are sent to the Hugging Face-hosted OmniVoice ZeroGPU speech service for voice cloning and speech generation. Hugging Face and the respective service operators control their own infrastructure and retention practices.</li>
      </ul>
      <p>We do not sell personal information. External providers process data under their own terms and privacy policies. Do not upload another person's voice unless you have explicit permission.</p>

      <h2>4. Retention and deletion</h2>
      <p>Creovanta-controlled account records and private voice samples are retained while your account is active. You can request deletion from inside the app or through our <Link href="/delete-account" style={{color:"#70d9e8"}}>account deletion page</Link>. Deleting your account removes the Creovanta account and associated database records and private voice samples. Audio history saved only in your browser can be removed from the app's Audio History or by clearing that browser's site data.</p>
      <p>Copies already sent to external speech providers may be subject to those providers' own retention and deletion processes. Creovanta cannot guarantee deletion from an external provider's systems unless that provider confirms it.</p>

      <h2>5. Security</h2>
      <p>We use HTTPS, account-scoped access controls, and private storage for uploaded voice samples. Access tokens and service credentials are not intended to be exposed in public client code. No internet service can guarantee absolute security.</p>

      <h2>6. Children's privacy</h2>
      <p>Creovanta is not designed for children. Do not create an account or upload a child's voice recording without the legally required parent or guardian authority and permission.</p>

      <h2>7. Your choices</h2>
      <p>You may disconnect your generation account, delete locally stored audio history, stop using the service, or delete your Creovanta account. You must only upload voices you own or are authorized to use.</p>

      <h2>8. Contact</h2>
      <p>For privacy questions, use the developer contact email published on the Creovanta Google Play Store listing. A monitored privacy contact email must be added to the public listing before production publication.</p>

      <p style={{marginTop:32}}><Link href="/" style={{color:"#70d9e8"}}>Back to Creovanta</Link></p>
    </main>
  );
}

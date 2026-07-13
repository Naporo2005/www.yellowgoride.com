// =========================================================
// YellowRide — supabase-config.js (v2)
// Core Supabase client + auth/session helpers
// Load this BEFORE any page-specific script.
// =========================================================
// AUTH MODEL:
//   Drivers ("Servers")   -> sign up & log in with a REAL email + password.
//                             (No OTP cost — Supabase's built-in "Confirm email"
//                              setting is turned OFF, so no email is ever sent.)
//   Passengers ("Clients")-> sign up & log in with PHONE NUMBER + password.
//                             Internally uses a hidden synthetic email
//                             (e.g. "0244000000@yellowride.local") since
//                             Supabase Auth needs an email-shaped identifier —
//                             the passenger never sees or types this.
//   Both paths require ZERO SMS/email spend.
// =========================================================

// --- Supabase Project Credentials ---
const SUPABASE_URL = "https://ygdydzwhtcfuoedyxvjb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_1OJYpFSbWz_YsfM1GkWo7Q_-48YPiHS";

// Requires the Supabase JS library loaded via CDN in your HTML:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function phoneToSyntheticEmail(phoneNumber) {
  const digitsOnly = phoneNumber.replace(/\D/g, '');
  return `${digitsOnly}@yellowride.local`;
}

function friendlyAuthError(error) {
  const msg = error.message.toLowerCase();
  if (msg.includes('rate limit')) {
    return "Signup is temporarily rate-limited. Make sure 'Confirm email' is turned OFF in Supabase Auth settings.";
  }
  if (msg.includes('already registered')) {
    return "An account already exists with these details. Try logging in instead.";
  }
  if (msg.includes('invalid login credentials')) {
    return "Incorrect login details. Please check and try again.";
  }
  return error.message;
}

// =========================================================
// DRIVER ("SERVER") AUTH — real email + password
// =========================================================

/**
 * Sign up a new driver ("server"). Requires a real email — no OTP needed
 * since email confirmation is disabled in Supabase Auth settings.
 * @param {Object} params
 * @param {string} params.fullName
 * @param {string} params.email
 * @param {string} params.phoneNumber
 * @param {string} params.password
 * @param {string} params.vehiclePlateNumber
 */
async function signUpDriver({ fullName, email, phoneNumber, password, vehiclePlateNumber }) {
  const { data: authData, error: authError } = await supabaseClient.auth.signUp({ email, password });

  if (authError) return { success: false, error: friendlyAuthError(authError) };

  const userId = authData.user?.id;
  if (!userId) {
    return { success: false, error: "Signup failed unexpectedly. Make sure 'Confirm email' is turned OFF in Supabase Auth settings." };
  }

  const { error: profileError } = await supabaseClient.from("profiles").insert({
    id: userId, role: "driver", full_name: fullName, phone_number: phoneNumber, email,
  });
  if (profileError) return { success: false, error: profileError.message };

  const driverCode = "YR-DRV-" + Math.floor(1000 + Math.random() * 9000);
  const { error: driverError } = await supabaseClient.from("drivers").insert({
    id: userId,
    driver_code: driverCode,
    vehicle_plate_number: vehiclePlateNumber,
    verification_status: "pending",
  });
  if (driverError) return { success: false, error: driverError.message };

  return { success: true, user: authData.user };
}

/**
 * Log in an existing driver with email + password.
 */
async function loginDriver({ email, password }) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return { success: false, error: friendlyAuthError(error) };

  const profile = await getCurrentProfile();
  return { success: true, user: data.user, profile };
}

// =========================================================
// PASSENGER ("CLIENT") AUTH — phone number + password
// =========================================================

/**
 * Sign up a new passenger ("client"). Uses phone number as the real-world
 * identifier; email is optional and stored for contact purposes only.
 * @param {Object} params
 * @param {string} params.fullName
 * @param {string} params.phoneNumber
 * @param {string} [params.email] - optional, not used for login
 * @param {string} params.password
 */
async function signUpPassenger({ fullName, phoneNumber, email, password }) {
  const syntheticEmail = phoneToSyntheticEmail(phoneNumber);

  const { data: authData, error: authError } = await supabaseClient.auth.signUp({
    email: syntheticEmail, password,
  });
  if (authError) return { success: false, error: friendlyAuthError(authError) };

  const userId = authData.user?.id;
  if (!userId) {
    return { success: false, error: "Signup failed unexpectedly. Make sure 'Confirm email' is turned OFF in Supabase Auth settings." };
  }

  const { error: profileError } = await supabaseClient.from("profiles").insert({
    id: userId, role: "passenger", full_name: fullName, phone_number: phoneNumber,
    email: email || null,
  });
  if (profileError) return { success: false, error: profileError.message };

  const { error: passengerError } = await supabaseClient.from("passengers").insert({ id: userId });
  if (passengerError) return { success: false, error: passengerError.message };

  return { success: true, user: authData.user };
}

/**
 * Log in an existing passenger using their phone number + password.
 */
async function loginPassenger({ phoneNumber, password }) {
  const syntheticEmail = phoneToSyntheticEmail(phoneNumber);
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email: syntheticEmail, password });
  if (error) return { success: false, error: friendlyAuthError(error) };

  const profile = await getCurrentProfile();
  return { success: true, user: data.user, profile };
}

// =========================================================
// SHARED AUTH HELPERS
// =========================================================

async function logoutUser() {
  const { error } = await supabaseClient.auth.signOut();
  return { success: !error, error: error?.message };
}

async function getCurrentProfile() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabaseClient.from("profiles").select("*").eq("id", user.id).single();
  if (error) {
    console.error("Failed to load profile:", error.message);
    return null;
  }
  return data;
}

/**
 * Route-guard helper: call at the top of each role-specific page.
 * @param {'passenger'|'driver'|'admin'} requiredRole
 */
async function requireRole(requiredRole) {
  const profile = await getCurrentProfile();

  if (!profile) {
    window.location.href = "login.html";
    return null;
  }
  if (profile.status === "suspended" || profile.status === "banned") {
    await logoutUser();
    window.location.href = "login.html?error=account_suspended";
    return null;
  }
  if (profile.role !== requiredRole) {
    const redirectMap = {
      passenger: "passenger-dashboard.html",
      driver: "driver-dashboard.html",
      admin: "admin-dashboard.html",
    };
    window.location.href = redirectMap[profile.role] || "login.html";
    return null;
  }
  return profile;
}

// =========================================================
// DRIVER DAILY FEE PAYMENTS
// =========================================================

/**
 * Submit today's fee payment claim (driver enters their MoMo transaction reference).
 * Goes to 'pending' until an admin approves it.
 */
async function submitFeePayment(driverId, amount, momoTransactionReference) {
  const { data, error } = await supabaseClient
    .from("driver_fee_payments")
    .upsert({
      driver_id: driverId,
      amount,
      momo_transaction_reference: momoTransactionReference,
      payment_date: new Date().toISOString().slice(0, 10), // today, YYYY-MM-DD
      status: "pending",
      submitted_at: new Date().toISOString(),
    }, { onConflict: "driver_id,payment_date" })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, payment: data };
}

/**
 * Check whether a driver is cleared to go online today.
 */
async function getFeeStatusToday(driverId) {
  const { data, error } = await supabaseClient
    .from("driver_fee_status_today")
    .select("*")
    .eq("driver_id", driverId)
    .single();

  if (error) return { isClearedToday: false, status: null };
  return { isClearedToday: data.is_cleared_today, status: data.today_payment_status };
}

/**
 * Get a driver's fee payment history.
 */
async function getFeePaymentHistory(driverId, limit = 30) {
  const { data, error } = await supabaseClient
    .from("driver_fee_payments")
    .select("*")
    .eq("driver_id", driverId)
    .order("payment_date", { ascending: false })
    .limit(limit);

  if (error) return [];
  return data;
}

// =========================================================
// REALTIME HELPERS
// =========================================================

function subscribeToRide(rideId, onChange) {
  const channel = supabaseClient
    .channel(`ride-${rideId}`)
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "rides", filter: `id=eq.${rideId}` },
      (payload) => onChange(payload.new)
    )
    .subscribe();
  return () => supabaseClient.removeChannel(channel);
}

function subscribeToDriverLocation(driverId, onLocationChange) {
  const channel = supabaseClient
    .channel(`driver-location-${driverId}`)
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "drivers", filter: `id=eq.${driverId}` },
      (payload) => {
        const { current_lat, current_lng } = payload.new;
        if (current_lat && current_lng) onLocationChange(current_lat, current_lng);
      }
    )
    .subscribe();
  return () => supabaseClient.removeChannel(channel);
}

async function updateDriverLocation(driverId, lat, lng) {
  const { error } = await supabaseClient.from("drivers").update({ current_lat: lat, current_lng: lng }).eq("id", driverId);
  return { success: !error, error: error?.message };
}

// =========================================================
// STORAGE HELPERS
// =========================================================

async function uploadAvatar(userId, file) {
  const filePath = `${userId}/${Date.now()}_${file.name}`;
  const { error } = await supabaseClient.storage.from("avatars").upload(filePath, file, { upsert: true });
  if (error) return { success: false, error: error.message };

  const { data } = supabaseClient.storage.from("avatars").getPublicUrl(filePath);
  await supabaseClient.from("profiles").update({ avatar_url: data.publicUrl }).eq("id", userId);
  return { success: true, url: data.publicUrl };
}

/**
 * Upload a driver document (license, national ID, selfie-with-ID, etc). Bucket: "driver-documents" (private)
 */
async function uploadDriverDocument(driverId, file, documentType) {
  const filePath = `${driverId}/${documentType}_${Date.now()}_${file.name}`;
  const { error: uploadError } = await supabaseClient.storage.from("driver-documents").upload(filePath, file, { upsert: true });
  if (uploadError) return { success: false, error: uploadError.message };

  const { error: insertError } = await supabaseClient.from("driver_documents").insert({
    driver_id: driverId, document_type: documentType, file_url: filePath, status: "pending",
  });
  if (insertError) return { success: false, error: insertError.message };
  return { success: true, path: filePath };
}

// =========================================================
// Export onto window for page scripts
// =========================================================
window.YellowRide = {
  supabaseClient,
  // driver auth
  signUpDriver,
  loginDriver,
  // passenger auth
  signUpPassenger,
  loginPassenger,
  // shared
  logoutUser,
  getCurrentProfile,
  requireRole,
  // fee payments
  submitFeePayment,
  getFeeStatusToday,
  getFeePaymentHistory,
  // realtime
  subscribeToRide,
  subscribeToDriverLocation,
  updateDriverLocation,
  // storage
  uploadAvatar,
  uploadDriverDocument,
};

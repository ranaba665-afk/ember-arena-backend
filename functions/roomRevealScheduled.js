/**
 * Alternative: Firebase Cloud Function version of the same logic,
 * for if you go with Firestore instead of / alongside MongoDB.
 * Uses Cloud Scheduler under the hood via functions.pubsub.schedule.
 *
 * Requires: firebase-functions, firebase-admin
 * Deploy: firebase deploy --only functions:revealDueRooms
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

exports.revealDueRooms = functions.pubsub
  .schedule("every 1 minutes")
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const tenMinutesFromNow = admin.firestore.Timestamp.fromMillis(
      now.toMillis() + 10 * 60 * 1000
    );

    const snapshot = await db
      .collection("tournaments")
      .where("status", "==", "upcoming")
      .where("room.isRevealed", "==", false)
      .where("schedule", ">=", now)
      .where("schedule", "<=", tenMinutesFromNow)
      .get();

    if (snapshot.empty) {
      return null;
    }

    // Batch writes so all reveals happen atomically together.
    const batch = db.batch();
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (!data.room || !data.room.roomId) return; // admin hasn't set room yet
      batch.update(doc.ref, {
        "room.isRevealed": true,
        "room.revealedAt": now,
      });
    });

    await batch.commit();
    console.log(`Revealed room details for ${snapshot.size} tournament(s).`);
    return null;
  });

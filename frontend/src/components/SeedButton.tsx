import { useState } from "react";
import { useMutation } from "@apollo/client/react";
import { INGEST_MESSAGE } from "../graphql/mutations";
import { generateSeedMessages } from "../data/seedMessages";

const CREATOR_ID = "00000000-0000-4000-a000-000000000001";

export default function SeedButton() {
  const [isSeeding, setIsSeeding] = useState(false);
  const [ingestMessage] = useMutation(INGEST_MESSAGE);

  const handleSeed = async () => {
    setIsSeeding(true);
    console.log("Starting seed...");
    const iteration = Date.now(); // Always unique

    // Generate random messages for this seed run (demonstrates semantic similarity)
    const seedMessages = generateSeedMessages(3); // 3 messages per category = 12 total

    try {
      for (let i = 0; i < seedMessages.length; i++) {
        const msg = seedMessages[i];
        // Each user gets a unique ID per seed run (simulating different visitors asking same questions)
        const uniqueUserId = `${msg.userId}-${iteration}`;
        const uniqueUsername = `${msg.username} ${iteration % 1000}`; // Add unique suffix to username
        const result = await ingestMessage({
          variables: {
            input: {
              creatorId: CREATOR_ID,
              messageId: `seed-msg-${iteration}-${i}`,
              text: msg.text,
              channelId: `channel-${uniqueUserId}`, // Static per user (1:1 relationship)
              channelCid: `messaging:channel-${uniqueUserId}`,
              visitorUserId: uniqueUserId,
              visitorUsername: uniqueUsername,
              createdAt: new Date().toISOString(),
              isPaidDm: false,
              rawPayload: {
                user: {
                  id: uniqueUserId,
                  name: msg.username,
                  image: `https://i.pravatar.cc/150?u=${uniqueUserId}`,
                },
              },
            },
          },
        });
        console.log(
          `Seeded message ${i + 1}/${seedMessages.length}`,
          result.data,
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      console.log("Seed complete! Waiting for clusters to form...");
      // Wait a bit for clustering to complete, then reload
      await new Promise((resolve) => setTimeout(resolve, 2000));
      window.location.reload();
    } catch (err) {
      console.error("Error seeding data:", err);
      alert("Failed to seed data: " + (err as Error).message);
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="p-4 border-t">
      <button
        onClick={handleSeed}
        disabled={isSeeding}
        className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        {isSeeding ? "Seeding..." : "Seed Test Data"}
      </button>
      <p className="text-xs text-gray-500 text-center mt-2">
        Generate 12 varied messages (shows semantic clustering)
      </p>
    </div>
  );
}

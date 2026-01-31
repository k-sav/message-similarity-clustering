import { useState } from "react";
import { useMutation } from "@apollo/client/react";
import { INGEST_MESSAGE } from "../graphql/mutations";

const CREATOR_ID = "00000000-0000-4000-a000-000000000001";

const SEED_MESSAGES = [
  // Cluster 1: Pricing questions
  {
    text: "How much do you charge for collaborations?",
    username: "Jane Ray",
    userId: "user-1",
  },
  {
    text: "What are your rates for sponsored content?",
    username: "Bob Smith",
    userId: "user-2",
  },
  {
    text: "Could you share your pricing for brand partnerships?",
    username: "Alice Johnson",
    userId: "user-3",
  },

  // Cluster 2: Availability/Scheduling
  {
    text: "When are you available for a collaboration?",
    username: "Charlie Brown",
    userId: "user-4",
  },
  {
    text: "What's your availability for next month?",
    username: "Diana Prince",
    userId: "user-5",
  },
  {
    text: "Do you have time to work with us in the next few weeks?",
    username: "Ethan Hunt",
    userId: "user-6",
  },

  // Cluster 3: Content/Portfolio questions
  {
    text: "What kind of content do you create?",
    username: "Fiona Apple",
    userId: "user-7",
  },
  {
    text: "Can you show me examples of your previous work?",
    username: "George Martin",
    userId: "user-8",
  },
  {
    text: "Do you have a portfolio I can review?",
    username: "Hannah Lee",
    userId: "user-9",
  },

  // Cluster 4: Technical support
  {
    text: "I'm having trouble accessing the link you sent",
    username: "Ian Malcolm",
    userId: "user-10",
  },
  {
    text: "The download link isn't working for me",
    username: "Julia Roberts",
    userId: "user-11",
  },
  {
    text: "Can you resend the link? It seems to be broken",
    username: "Kevin Hart",
    userId: "user-12",
  },
];

export default function SeedButton() {
  const [isSeeding, setIsSeeding] = useState(false);
  const [ingestMessage] = useMutation(INGEST_MESSAGE);

  const handleSeed = async () => {
    setIsSeeding(true);
    console.log("Starting seed...");
    const seedId = Date.now(); // Unique per seed run
    try {
      for (let i = 0; i < SEED_MESSAGES.length; i++) {
        const msg = SEED_MESSAGES[i];
        const result = await ingestMessage({
          variables: {
            input: {
              creatorId: CREATOR_ID,
              messageId: `seed-msg-${seedId}-${i}`,
              text: msg.text,
              channelId: `channel-${msg.userId}-${seedId}`, // Unique per seed run
              channelCid: `messaging:channel-${msg.userId}-${seedId}`,
              visitorUserId: msg.userId,
              visitorUsername: msg.username,
              createdAt: new Date().toISOString(),
              isPaidDm: false,
              rawPayload: {
                user: {
                  id: msg.userId,
                  name: msg.username,
                  image: `https://i.pravatar.cc/150?u=${msg.userId}`,
                },
              },
            },
          },
        });
        console.log(
          `Seeded message ${i + 1}/${SEED_MESSAGES.length}`,
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
        Generate {SEED_MESSAGES.length} test messages
      </p>
    </div>
  );
}

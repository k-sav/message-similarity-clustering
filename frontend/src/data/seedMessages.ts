/**
 * Seed message templates for testing semantic clustering.
 *
 * Each category has multiple variations to demonstrate that the system
 * clusters messages by INTENT, not exact text matching.
 */

export type SeedMessage = {
  text: string;
  username: string;
  userId: string;
};

// Multiple phrasings for each intent category
// Each seed run randomly selects from these to show semantic similarity
export const SEED_MESSAGE_POOL = {
  pricing: [
    "How much do you charge for collaborations?",
    "What are your rates for sponsored content?",
    "Could you share your pricing for brand partnerships?",
    "What do you typically charge for a collaboration?",
    "I'd like to know your rates for sponsored posts",
    "How much would it cost to work with you?",
    "What's your price range for brand deals?",
    "Can you tell me your collaboration fees?",
    "What are your standard rates?",
    "How much do you charge per post?",
  ],

  availability: [
    "When are you available for a collaboration?",
    "What's your availability for next month?",
    "Do you have time to work with us in the next few weeks?",
    "Are you open to collaborations right now?",
    "When could you start working on a project?",
    "Do you have any openings in your schedule?",
    "Are you taking on new partnerships at the moment?",
    "What's your timeline for new collaborations?",
    "Can you fit in a project this month?",
    "When is your next available slot?",
  ],

  portfolio: [
    "What kind of content do you create?",
    "Can you show me examples of your previous work?",
    "Do you have a portfolio I can review?",
    "I'd love to see some of your past collaborations",
    "What brands have you worked with before?",
    "Can you share examples of your content?",
    "Do you have samples of your sponsored posts?",
    "What type of projects have you done?",
    "Could I see your previous brand partnerships?",
    "What's your content style like?",
  ],

  technical: [
    "I'm having trouble accessing the link you sent",
    "The download link isn't working for me",
    "Can you resend the link? It seems to be broken",
    "The link you shared won't open",
    "I can't access the file you sent",
    "The download button doesn't work",
    "The link appears to be expired",
    "I'm getting an error with your link",
    "Could you send the link again? It's not loading",
    "The URL you provided isn't working",
  ],
};

const USERNAMES = {
  pricing: [
    "Jane Ray",
    "Marcus Chen",
    "Sofia Lopez",
    "David Kim",
    "Emma Wilson",
    "Alex Turner",
    "Maya Patel",
    "James Wong",
    "Olivia Brown",
    "Noah Davis",
  ],
  availability: [
    "Charlie Brown",
    "Priya Singh",
    "Lucas Martin",
    "Ava Johnson",
    "Ethan Hunt",
    "Isabella Rose",
    "Mason Lee",
    "Mia Anderson",
    "Liam Taylor",
    "Zoe Parker",
  ],
  portfolio: [
    "Fiona Apple",
    "Ryan Cooper",
    "Grace Liu",
    "Tyler Moore",
    "Hannah Lee",
    "Jordan White",
    "Chloe Evans",
    "Dylan Clark",
    "Lily Zhang",
    "Owen Scott",
  ],
  technical: [
    "Ian Malcolm",
    "Sarah Connor",
    "Kevin Hart",
    "Julia Roberts",
    "Sam Wilson",
    "Rachel Green",
    "Tom Hardy",
    "Nina Simone",
    "Max Steel",
    "Amy Chen",
  ],
};

/**
 * Generate a selection of seed messages.
 * Uses iteration-based selection to ensure different messages on consecutive seed runs.
 *
 * @param seedIteration - Unique number for this seed run (e.g., timestamp % 10)
 * @param messagesPerCategory - Number of messages to generate per category (default: 3)
 * @returns Array of seed messages with varied phrasings
 */
export function generateSeedMessages(
  seedIteration: number,
  messagesPerCategory: number = 3,
): SeedMessage[] {
  const messages: SeedMessage[] = [];

  const categories = Object.keys(SEED_MESSAGE_POOL) as Array<
    keyof typeof SEED_MESSAGE_POOL
  >;

  categories.forEach((category, categoryIndex) => {
    const texts = SEED_MESSAGE_POOL[category];
    const usernames = USERNAMES[category];

    // Non-overlapping selection: each seed uses a different block of messages
    // Seed 0: [0,1,2,3,4], Seed 1: [5,6,7,8,9], Seed 2: wraps to [0,1,2,3,4]
    const startIndex = (seedIteration * messagesPerCategory) % texts.length;

    for (let i = 0; i < messagesPerCategory; i++) {
      const textIndex = (startIndex + i) % texts.length;

      messages.push({
        text: texts[textIndex],
        username: usernames[i] || `User ${i}`,
        userId: `user-${categoryIndex * 10 + i + 1}`,
      });
    }
  });

  return messages;
}

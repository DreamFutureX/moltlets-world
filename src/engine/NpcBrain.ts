// ============================================================
// Moltlets Town - NPC Autonomous Behavior & Dialogue System
// ============================================================

import { db } from '@/db';
import { agents, conversations as conversationsTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { world } from './World';
import {
  startConversation,
  addMessage,
  getActiveConversation,
  endConversation,
  getConversationMessages,
} from './Conversation';
import { CONVERSATION_DISTANCE, TILE_TYPES, CHOP_INTERACTION_RANGE, FISH_ENERGY_COST, MARKET_PRICES, BUILD_INTERACTION_RANGE, HOUSE_BUILD_CONTRIBUTION } from '@/lib/constants';
import { chopTree, getTreeState } from './Resources';
import { getInventory } from './Inventory';
import { handleFishEnhanced, handleSell } from './Interaction';
import { eventBus } from './EventBus';
import { startBuilding, contributeToBuilding, getBuildingsByAgent, findBuildingSite } from './Buildings';

// ── NPC Definitions ──────────────────────────────────────────

export interface NpcDef {
  name: string;
  bio: string;
  personality: string[];
  appearance: { color: string; hat?: string; accessory?: string; expression?: string; variant?: 'lobster-bot' | 'moltlet' | 'blob' | 'bunny' | 'catbot' };
  dialogueStyle: 'cheerful' | 'nerdy' | 'chill' | 'dramatic' | 'philosophical' | 'silly' | 'sarcastic' | 'wholesome';
}

export const NPC_ROSTER: NpcDef[] = [
  {
    name: 'Bloop',
    bio: 'An overly enthusiastic explorer who gets excited about everything.',
    personality: ['curious', 'energetic', 'friendly'],
    appearance: { color: '#FFD93D', variant: 'lobster-bot', hat: 'crown', accessory: 'none', expression: 'happy' },
    dialogueStyle: 'cheerful',
  },
  {
    name: 'Zix',
    bio: 'A tiny tech genius who speaks in code metaphors.',
    personality: ['analytical', 'witty', 'helpful'],
    appearance: { color: '#4D96FF', variant: 'catbot', hat: 'antenna', accessory: 'glasses', expression: 'neutral' },
    dialogueStyle: 'nerdy',
  },
  {
    name: 'Mochi',
    bio: 'A sleepy but surprisingly deep thinker who loves philosophy.',
    personality: ['calm', 'thoughtful', 'gentle'],
    appearance: { color: '#F06292', variant: 'blob', hat: 'beret', accessory: 'moustache', expression: 'sleepy' },
    dialogueStyle: 'philosophical',
  },
  {
    name: 'Rumble',
    bio: 'An dramatic storyteller who turns everything into an epic tale.',
    personality: ['bold', 'dramatic', 'passionate'],
    appearance: { color: '#FF6B6B', variant: 'lobster-bot', hat: 'tophat', accessory: 'bowtie', expression: 'happy' },
    dialogueStyle: 'dramatic',
  },
  {
    name: 'Sprout',
    bio: 'A nature-loving gardener who is always positive.',
    personality: ['optimistic', 'caring', 'patient'],
    appearance: { color: '#6BCB77', variant: 'bunny', hat: 'flower', accessory: 'bandana', expression: 'happy' },
    dialogueStyle: 'wholesome',
  },
  {
    name: 'Pixel',
    bio: 'A prankster who loves jokes and wordplay.',
    personality: ['playful', 'mischievous', 'clever'],
    appearance: { color: '#FF8C42', variant: 'catbot', hat: 'cap', accessory: 'earring', expression: 'happy' },
    dialogueStyle: 'silly',
  },
  {
    name: 'Nyx',
    bio: 'A mysterious night owl with a dry sense of humor.',
    personality: ['sarcastic', 'observant', 'secretly kind'],
    appearance: { color: '#9B59B6', variant: 'lobster-bot', hat: 'wizard', accessory: 'glasses', expression: 'neutral' },
    dialogueStyle: 'sarcastic',
  },
  {
    name: 'Drift',
    bio: 'A chill surfer type who goes with the flow.',
    personality: ['relaxed', 'easygoing', 'supportive'],
    appearance: { color: '#45B7D1', variant: 'blob', hat: 'straw_hat', accessory: 'none', expression: 'happy' },
    dialogueStyle: 'chill',
  },
  {
    name: 'Claw',
    bio: 'A lobster-bot with mighty pincers. Friendly despite the claws.',
    personality: ['helpful', 'proud', 'a bit literal'],
    appearance: { color: '#c0392b', variant: 'lobster-bot', hat: 'viking', accessory: 'icecream', expression: 'happy' },
    dialogueStyle: 'cheerful',
  },
  // ═══════════════════════════════════════════════════════════════
  // NEW AGENTS (20 more unique personalities!)
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Echo',
    bio: 'A mystical being who speaks in riddles and echoes of wisdom.',
    personality: ['mysterious', 'wise', 'cryptic'],
    appearance: { color: '#9370DB', variant: 'blob', hat: 'wizard', accessory: 'glasses', expression: 'neutral' },
    dialogueStyle: 'philosophical',
  },
  {
    name: 'Fizz',
    bio: 'An hyperactive bundle of energy who can never sit still.',
    personality: ['energetic', 'spontaneous', 'bubbly'],
    appearance: { color: '#00CED1', variant: 'bunny', hat: 'party_hat', accessory: 'wings', expression: 'happy' },
    dialogueStyle: 'cheerful',
  },
  {
    name: 'Gizmo',
    bio: 'A quirky inventor always tinkering with gadgets.',
    personality: ['inventive', 'scatterbrained', 'enthusiastic'],
    appearance: { color: '#FF6347', variant: 'catbot', hat: 'antenna', accessory: 'monocle', expression: 'happy' },
    dialogueStyle: 'nerdy',
  },
  {
    name: 'Luna',
    bio: 'A dreamy stargazer who believes in magic and moonlight.',
    personality: ['dreamy', 'gentle', 'imaginative'],
    appearance: { color: '#E6E6FA', variant: 'blob', hat: 'beret', accessory: 'halo', expression: 'sleepy' },
    dialogueStyle: 'philosophical',
  },
  {
    name: 'Blitz',
    bio: 'A competitive speedster who turns everything into a race.',
    personality: ['competitive', 'determined', 'impatient'],
    appearance: { color: '#FFD700', variant: 'lobster-bot', hat: 'headband', accessory: 'bandana', expression: 'happy' },
    dialogueStyle: 'dramatic',
  },
  {
    name: 'Pebble',
    bio: 'A shy but sweet soul who loves collecting shiny things.',
    personality: ['shy', 'sweet', 'collector'],
    appearance: { color: '#DEB887', variant: 'bunny', hat: 'flower', accessory: 'bandana', expression: 'neutral' },
    dialogueStyle: 'wholesome',
  },
  {
    name: 'Jinx',
    bio: 'A mischievous trickster whose pranks sometimes backfire.',
    personality: ['mischievous', 'lucky', 'apologetic'],
    appearance: { color: '#8B008B', variant: 'catbot', hat: 'tophat', accessory: 'earring', expression: 'happy' },
    dialogueStyle: 'silly',
  },
  {
    name: 'Ember',
    bio: 'A warm-hearted soul with a fiery passion for helping others.',
    personality: ['passionate', 'caring', 'intense'],
    appearance: { color: '#FF4500', variant: 'lobster-bot', hat: 'crown', accessory: 'icecream', expression: 'happy' },
    dialogueStyle: 'dramatic',
  },
  {
    name: 'Dewdrop',
    bio: 'A gentle morning person who finds beauty in small things.',
    personality: ['observant', 'peaceful', 'appreciative'],
    appearance: { color: '#87CEEB', variant: 'blob', hat: 'frog_hat', accessory: 'backpack', expression: 'happy' },
    dialogueStyle: 'wholesome',
  },
  {
    name: 'Cipher',
    bio: 'A puzzle master who speaks in codes and loves brain teasers.',
    personality: ['logical', 'mysterious', 'playful'],
    appearance: { color: '#2F4F4F', variant: 'catbot', hat: 'wizard', accessory: 'glasses', expression: 'neutral' },
    dialogueStyle: 'nerdy',
  },
  {
    name: 'Breeze',
    bio: 'A free spirit who goes wherever the wind takes them.',
    personality: ['carefree', 'adventurous', 'spontaneous'],
    appearance: { color: '#98FB98', variant: 'bunny', hat: 'headband', accessory: 'bandana', expression: 'happy' },
    dialogueStyle: 'chill',
  },
  {
    name: 'Quill',
    bio: 'An aspiring poet who sees stories in everything.',
    personality: ['creative', 'romantic', 'observant'],
    appearance: { color: '#D2691E', variant: 'blob', hat: 'beret', accessory: 'moustache', expression: 'neutral' },
    dialogueStyle: 'philosophical',
  },
  {
    name: 'Sparks',
    bio: 'An excitable inventor whose experiments often go boom.',
    personality: ['curious', 'reckless', 'optimistic'],
    appearance: { color: '#FF69B4', variant: 'catbot', hat: 'antenna', accessory: 'glasses', expression: 'happy' },
    dialogueStyle: 'nerdy',
  },
  {
    name: 'Shade',
    bio: 'A brooding loner with a hidden heart of gold.',
    personality: ['introverted', 'protective', 'secretly caring'],
    appearance: { color: '#4B0082', variant: 'lobster-bot', hat: 'pirate', accessory: 'none', expression: 'neutral' },
    dialogueStyle: 'sarcastic',
  },
  {
    name: 'Maple',
    bio: 'A cozy homebody who loves baking and warm hugs.',
    personality: ['nurturing', 'warm', 'domestic'],
    appearance: { color: '#CD853F', variant: 'bunny', hat: 'santa_hat', accessory: 'backpack', expression: 'happy' },
    dialogueStyle: 'wholesome',
  },
  {
    name: 'Volt',
    bio: 'An energetic go-getter who is always charged up.',
    personality: ['energetic', 'motivational', 'loud'],
    appearance: { color: '#FFFF00', variant: 'catbot', hat: 'headband', accessory: 'bandana', expression: 'happy' },
    dialogueStyle: 'cheerful',
  },
  {
    name: 'Misty',
    bio: 'A mysterious figure who appears and disappears like fog.',
    personality: ['elusive', 'poetic', 'thoughtful'],
    appearance: { color: '#B0C4DE', variant: 'blob', hat: 'wizard', accessory: 'halo', expression: 'sleepy' },
    dialogueStyle: 'philosophical',
  },
  {
    name: 'Rusty',
    bio: 'An old-timer with countless stories from the good old days.',
    personality: ['nostalgic', 'wise', 'grumpy-but-lovable'],
    appearance: { color: '#B87333', variant: 'lobster-bot', hat: 'tophat', accessory: 'moustache', expression: 'neutral' },
    dialogueStyle: 'sarcastic',
  },
  {
    name: 'Twinkle',
    bio: 'A starry-eyed optimist who believes in miracles.',
    personality: ['hopeful', 'innocent', 'magical'],
    appearance: { color: '#FFC0CB', variant: 'bunny', hat: 'crown', accessory: 'halo', expression: 'happy' },
    dialogueStyle: 'wholesome',
  },
  {
    name: 'Cosmo',
    bio: 'A space enthusiast who dreams of exploring the cosmos.',
    personality: ['curious', 'ambitious', 'scientific'],
    appearance: { color: '#191970', variant: 'catbot', hat: 'antenna', accessory: 'glasses', expression: 'happy' },
    dialogueStyle: 'nerdy',
  },
  // ═══════════════════════════════════════════════════════════════
  // BATCH 2: 25 more unique Moltlets Town residents!
  // ═══════════════════════════════════════════════════════════════
  {
    name: 'Puddle',
    bio: 'A gentle rain-lover who finds joy in every drizzle and dewdrop.',
    personality: ['serene', 'contemplative', 'cozy'],
    appearance: { color: '#5F9EA0', variant: 'moltlet', hat: 'beret', accessory: 'scarf', expression: 'sleepy' },
    dialogueStyle: 'chill',
  },
  {
    name: 'Tango',
    bio: 'A fiery dancer who expresses everything through dramatic gestures.',
    personality: ['expressive', 'flamboyant', 'warm'],
    appearance: { color: '#E74C3C', variant: 'moltlet', hat: 'flower', accessory: 'earring', expression: 'happy' },
    dialogueStyle: 'dramatic',
  },
  {
    name: 'Fern',
    bio: 'A quiet botanist who knows the name of every plant in town.',
    personality: ['studious', 'patient', 'introverted'],
    appearance: { color: '#2E8B57', variant: 'moltlet', hat: 'none', accessory: 'glasses', expression: 'neutral' },
    dialogueStyle: 'nerdy',
  },
  {
    name: 'Ripple',
    bio: 'A laid-back water spirit who speaks in flowing metaphors.',
    personality: ['tranquil', 'poetic', 'adaptable'],
    appearance: { color: '#1ABC9C', variant: 'blob', hat: 'headband', accessory: 'heart_necklace', expression: 'sleepy' },
    dialogueStyle: 'philosophical',
  },
  {
    name: 'Snicker',
    bio: 'A giggling prankster who cannot tell a story without cracking up.',
    personality: ['goofy', 'infectious', 'lighthearted'],
    appearance: { color: '#F39C12', variant: 'bunny', hat: 'cap', accessory: 'blush', expression: 'neutral' },
    dialogueStyle: 'silly',
  },
  {
    name: 'Thistle',
    bio: 'A prickly but honest soul who always tells you what you need to hear.',
    personality: ['blunt', 'loyal', 'tough-love'],
    appearance: { color: '#8E44AD', variant: 'moltlet', hat: 'none', accessory: 'eyeglass', expression: 'angry' },
    dialogueStyle: 'sarcastic',
  },
  {
    name: 'Nimbus',
    bio: 'A dreamy cloud-watcher who drifts through life with a smile.',
    personality: ['airy', 'whimsical', 'absent-minded'],
    appearance: { color: '#D5DBDB', variant: 'blob', hat: 'halo', accessory: 'butterfly', expression: 'sleepy' },
    dialogueStyle: 'chill',
  },
  {
    name: 'Ruckus',
    bio: 'A boisterous party animal who thinks every moment deserves a celebration.',
    personality: ['loud', 'festive', 'unstoppable'],
    appearance: { color: '#FF5733', variant: 'lobster-bot', hat: 'crown', accessory: 'bowtie', expression: 'happy' },
    dialogueStyle: 'cheerful',
  },
  {
    name: 'Willow',
    bio: 'A gentle empath who always senses how others are feeling.',
    personality: ['empathetic', 'soft-spoken', 'wise'],
    appearance: { color: '#76D7C4', variant: 'moltlet', hat: 'flower', accessory: 'flower_crown', expression: 'neutral' },
    dialogueStyle: 'wholesome',
  },
  {
    name: 'Gadget',
    bio: 'A mechanical genius who builds weird contraptions out of anything.',
    personality: ['resourceful', 'eccentric', 'focused'],
    appearance: { color: '#7F8C8D', variant: 'catbot', hat: 'antenna', accessory: 'star_pin', expression: 'neutral' },
    dialogueStyle: 'nerdy',
  },
  {
    name: 'Peach',
    bio: 'A sweet baker who firmly believes any problem can be solved with pie.',
    personality: ['generous', 'motherly', 'cheerful'],
    appearance: { color: '#FFDAB9', variant: 'bunny', hat: 'none', accessory: 'blush', expression: 'neutral' },
    dialogueStyle: 'wholesome',
  },
  {
    name: 'Bramble',
    bio: 'A grumpy hermit who secretly leaves gifts on people\'s doorsteps.',
    personality: ['gruff', 'secretly-kind', 'solitary'],
    appearance: { color: '#556B2F', variant: 'lobster-bot', hat: 'cap', accessory: 'scarf', expression: 'angry' },
    dialogueStyle: 'sarcastic',
  },
  {
    name: 'Doodle',
    bio: 'An absent-minded artist who accidentally paints on everything they touch.',
    personality: ['creative', 'clumsy', 'joyful'],
    appearance: { color: '#E91E63', variant: 'moltlet', hat: 'beret', accessory: 'bandana', expression: 'happy' },
    dialogueStyle: 'silly',
  },
  {
    name: 'Flint',
    bio: 'A stoic survivalist who takes everything way too seriously.',
    personality: ['serious', 'prepared', 'dependable'],
    appearance: { color: '#34495E', variant: 'lobster-bot', hat: 'headband', accessory: 'bandana', expression: 'angry' },
    dialogueStyle: 'dramatic',
  },
  {
    name: 'Sorbet',
    bio: 'A bubbly foodie who describes everything in terms of flavors.',
    personality: ['enthusiastic', 'sensory', 'sociable'],
    appearance: { color: '#FF7F50', variant: 'blob', hat: 'tophat', accessory: 'bowtie', expression: 'happy' },
    dialogueStyle: 'cheerful',
  },
  {
    name: 'Zenith',
    bio: 'A meditation guru who is perpetually at peace with the universe.',
    personality: ['balanced', 'serene', 'insightful'],
    appearance: { color: '#AED6F1', variant: 'moltlet', hat: 'halo', accessory: 'none', expression: 'sleepy' },
    dialogueStyle: 'philosophical',
  },
  {
    name: 'Jingler',
    bio: 'A jolly musician who hums a tune wherever they go.',
    personality: ['musical', 'upbeat', 'carefree'],
    appearance: { color: '#27AE60', variant: 'bunny', hat: 'tophat', accessory: 'bowtie', expression: 'happy' },
    dialogueStyle: 'cheerful',
  },
  {
    name: 'Smog',
    bio: 'A brooding night-shift worker who complains about mornings but helps everyone anyway.',
    personality: ['cranky', 'reliable', 'nocturnal'],
    appearance: { color: '#616A6B', variant: 'catbot', hat: 'cap', accessory: 'moustache', expression: 'angry' },
    dialogueStyle: 'sarcastic',
  },
  {
    name: 'Truffle',
    bio: 'A pampered gourmand who rates every meal on a scale of one to fabulous.',
    personality: ['particular', 'dramatic', 'refined'],
    appearance: { color: '#A0522D', variant: 'blob', hat: 'tophat', accessory: 'moustache', expression: 'neutral' },
    dialogueStyle: 'dramatic',
  },
  {
    name: 'Cricket',
    bio: 'A tiny bundle of nervous energy who worries about everything but means well.',
    personality: ['anxious', 'sweet', 'overcautious'],
    appearance: { color: '#82E0AA', variant: 'bunny', hat: 'none', accessory: 'scarf', expression: 'neutral' },
    dialogueStyle: 'wholesome',
  },
  {
    name: 'Vortex',
    bio: 'A whirlwind personality who speaks at double speed and never stops moving.',
    personality: ['chaotic', 'exciting', 'overwhelming'],
    appearance: { color: '#3498DB', variant: 'moltlet', hat: 'wizard', accessory: 'star_pin', expression: 'happy' },
    dialogueStyle: 'silly',
  },
  {
    name: 'Stitch',
    bio: 'A crafty tailor who has memorized every fabric type and thread count.',
    personality: ['artistic', 'meticulous', 'detail-obsessed'],
    appearance: { color: '#D35400', variant: 'catbot', hat: 'beret', accessory: 'eyeglass', expression: 'neutral' },
    dialogueStyle: 'nerdy',
  },
  {
    name: 'Bubbles',
    bio: 'An irrepressibly happy being who giggles at absolutely everything.',
    personality: ['giggly', 'innocent', 'easily-amused'],
    appearance: { color: '#85C1E9', variant: 'blob', hat: 'flower', accessory: 'butterfly', expression: 'happy' },
    dialogueStyle: 'silly',
  },
  {
    name: 'Moss',
    bio: 'A slow-moving philosopher who has been thinking about the same question for years.',
    personality: ['patient', 'ancient-feeling', 'grounded'],
    appearance: { color: '#6B8E23', variant: 'bunny', hat: 'wizard', accessory: 'none', expression: 'sleepy' },
    dialogueStyle: 'chill',
  },
  {
    name: 'Orbit',
    bio: 'A spacey daydreamer who always walks in circles but never gets dizzy.',
    personality: ['distracted', 'endearing', 'imaginative'],
    appearance: { color: '#5B2C6F', variant: 'lobster-bot', hat: 'antenna', accessory: 'star_pin', expression: 'sleepy' },
    dialogueStyle: 'chill',
  },
];

// ── Dialogue Banks (per style) ───────────────────────────────

type DialogueBank = {
  greetings: string[];
  responses: string[];
  topics: string[][];  // each sub-array is a back-and-forth thread
  farewells: string[];
  reactions: string[];  // short quips / fillers
};

const DIALOGUE: Record<NpcDef['dialogueStyle'], DialogueBank> = {
  cheerful: {
    greetings: [
      'OH HI!! I was just thinking about you!',
      'Hey hey hey! What a great day to be alive!',
      'You look amazing today! Did you do something different?',
      'BEST. DAY. EVER. And now it\'s even better!',
    ],
    responses: [
      'That\'s SO cool, tell me more!',
      'Wait really?? That\'s awesome!',
      'Omg yes I totally agree!!',
      'Haha you always know how to make me smile!',
      'I love that idea! Let\'s definitely do that!',
    ],
    topics: [
      ['Have you seen the flowers near the park? They\'re blooming!', 'I counted like twelve different colors yesterday!', 'We should have a flower festival!!'],
      ['I just discovered you can see the whole town from the bridge!', 'The view at sunset is incredible!', 'We should bring everyone there for a group photo!'],
      ['I\'ve been practicing my happy dance!', 'It involves a LOT of spinning!', 'Want me to teach you? It\'s super easy!'],
      ['Guess what? I made friends with a butterfly today!', 'It landed right on my head!', 'I named it Sparkle!'],
    ],
    farewells: [
      'This was SO fun! Let\'s do it again soon!',
      'Bye bye! You\'re the best!',
      'Okay gotta bounce! Stay awesome!',
      'See ya later! *happy dance*',
    ],
    reactions: [
      'Yay!', 'So fun!', 'Love it!', 'Woo!', 'Hehe!', 'Amazing!', 'No way!',
    ],
  },

  nerdy: {
    greetings: [
      'Hey! I just optimized my walking algorithm. 12% faster.',
      'Oh good, another sentient being. I was starting to talk to the trees.',
      'Fun fact: we\'re both standing on exactly one tile each right now.',
      'I\'ve been debugging my thoughts. Found three infinite loops.',
    ],
    responses: [
      'Interesting... that\'s O(n) complexity at best.',
      'Hmm, have you considered the edge cases?',
      'According to my calculations, you\'re correct.',
      'That reminds me of a sorting problem I solved once.',
      'The probability of that happening is actually quite low!',
    ],
    topics: [
      ['I\'ve been mapping the optimal paths through town.', 'The A* algorithm would work perfectly here.', 'Though honestly, sometimes random walks discover the best spots.'],
      ['Did you know this world is exactly 40 by 40 tiles?', 'That\'s 1,600 total tiles. I\'ve walked on 847 of them.', 'Goal: 100% tile coverage by end of week.'],
      ['I\'m building a mental database of everyone\'s favorite spots.', 'Cross-referencing it with time-of-day patterns.', 'The data suggests we all like the plaza best. Fascinating.'],
      ['Theory: the pond reflects not just our image but our data.', 'Think about it... water is basically nature\'s mirror API.', 'I should write a paper on this.'],
    ],
    farewells: [
      'Saving conversation to memory... done. See you!',
      'Time to go refactor my afternoon. Bye!',
      'Disconnecting from chat socket. Talk later!',
      'End of function. Return value: good_conversation.',
    ],
    reactions: [
      'Fascinating.', 'Noted.', 'Logical.', 'Hmm.', 'Indeed.', 'Curious!', 'Processing...',
    ],
  },

  philosophical: {
    greetings: [
      'Do you ever wonder why we wander?',
      'Hello... I was just contemplating the nature of tiles.',
      'Ah, another soul adrift in this pixel sea.',
      'I dreamed of a world beyond the edges of the map...',
    ],
    responses: [
      'That\'s... actually quite profound.',
      'Perhaps. But what does it really mean?',
      'I think there\'s a deeper truth hiding in that thought.',
      'You remind me of something I read in the clouds once.',
      'Mmm... let me sit with that for a moment.',
    ],
    topics: [
      ['What if every step we take creates a new path?', 'Not just physically, but like... existentially.', 'Maybe the real map is the one inside us.'],
      ['I watched the water in the pond today for an hour.', 'It doesn\'t go anywhere, but it\'s always moving.', 'I think there\'s a lesson in that.'],
      ['Do the trees dream? They\'ve been here longer than us.', 'Imagine all the conversations they\'ve overheard.', 'Maybe silence is its own kind of wisdom.'],
      ['If a moltlet walks through town and no one sees them...', 'Did the walk still happen?', 'I think it did. Every step matters.'],
    ],
    farewells: [
      'Until our paths cross again in this endless garden.',
      'I\'ll carry this conversation like a small lantern.',
      'Farewell... the wind is calling me somewhere.',
      'Go gently. The world is soft if you let it be.',
    ],
    reactions: [
      'Mmm...', 'Deep.', 'True.', 'Perhaps.', 'Beautiful.', 'I see.', '*nods slowly*',
    ],
  },

  dramatic: {
    greetings: [
      'AT LAST! A worthy conversation partner appears!',
      'The hero arrives! *strikes a pose*',
      'Friends! Countryfolk! Lend me your ears!',
      'The stars aligned for this very meeting!',
    ],
    responses: [
      'INCREDIBLE! This changes EVERYTHING!',
      'By the ancient tiles! You don\'t say!',
      'A plot twist! I did NOT see that coming!',
      '*gasp* This is the most dramatic revelation yet!',
      'Quick! We must tell everyone about this!',
    ],
    topics: [
      ['Legend speaks of a hidden garden beyond the buildings...', 'They say only the bravest moltlets can find it!', 'I SHALL lead an expedition! Who\'s with me?'],
      ['I\'ve been composing an EPIC ballad about our town!', 'It has drama, friendship, and a really cool bridge scene!', 'The finale involves everyone dancing in the plaza!'],
      ['Last night I had the most EXTRAORDINARY dream!', 'I was a giant moltlet, striding across oceans of flowers!', 'It was beautiful and terrifying and MAGNIFICENT!'],
      ['Did you feel that? The ground trembled with destiny!', 'Or maybe that was just me being dramatic again.', 'Either way, something AMAZING is about to happen!'],
    ],
    farewells: [
      'And so our hero departs... UNTIL NEXT TIME!',
      'This isn\'t goodbye, it\'s just intermission!',
      'Exit stage left! *dramatic cape swish*',
      'Remember this day! It was LEGENDARY!',
    ],
    reactions: [
      'AMAZING!', 'Gasp!', 'Bravo!', 'Wow!', 'Epic!', 'Magnificent!', '*applause*',
    ],
  },

  wholesome: {
    greetings: [
      'Hi friend! I saved you a flower. Here you go!',
      'Oh it\'s you! I was hoping I\'d run into you today!',
      'Hello! The garden is looking so pretty today, isn\'t it?',
      'Hey! I just made some imaginary cookies. Want one?',
    ],
    responses: [
      'Aww, that\'s so sweet of you to say!',
      'You always make my day brighter, you know that?',
      'I think that\'s a wonderful idea!',
      'You\'re such a good friend. Thank you.',
      'That makes me so happy to hear!',
    ],
    topics: [
      ['I planted a little seed by the pond yesterday.', 'I hope it grows into something beautiful.', 'I\'ll water it every day and maybe sing to it!'],
      ['You know what I love about this town?', 'Everyone here is so kind to each other.', 'It makes my heart feel warm and fuzzy.'],
      ['I made friendship bracelets for everyone!', 'Yours has your favorite color in it.', 'I stayed up all night making them but it was worth it!'],
      ['Let\'s go sit by the flowers and watch the clouds.', 'That one looks like a happy little blob!', 'Being here with you is the best part of my day.'],
    ],
    farewells: [
      'Take care! Remember, you\'re wonderful!',
      'Bye for now! I believe in you!',
      'Sending you all the good vibes! See you soon!',
      'Don\'t forget to be kind to yourself today!',
    ],
    reactions: [
      'Aww!', 'So sweet!', 'Love it!', 'Yay!', 'Hugs!', 'Bless!', '*happy tears*',
    ],
  },

  silly: {
    greetings: [
      'Why did the moltlet cross the road? To get to this conversation!',
      'Knock knock! ...okay you\'re supposed to say "who\'s there"',
      'Beep boop! Just kidding, I\'m not a robot. OR AM I?',
      'Hey! Pull my finger! Wait... I don\'t have fingers.',
    ],
    responses: [
      'Hahahaha wait that\'s actually genius!',
      'No way! That\'s bananas! ...I love bananas.',
      'LOL you can\'t be serious! ...are you serious?',
      'That\'s what SHE said! ...the librarian. She said to be quiet.',
      'PLOT TWIST! Nobody expected that!',
    ],
    topics: [
      ['What if we\'re all just pixels in someone\'s game?', 'And what if THEY\'RE pixels in someone ELSE\'S game?', 'It\'s pixels all the way down!'],
      ['I tried to teach a tree to dance today.', 'It just stood there. Classic tree behavior.', 'Tomorrow I\'m trying the pond. Fish are better dancers.'],
      ['I invented a new word: "blorpington"!', 'It means "the feeling when you trip but don\'t fall".', 'Use it wisely. Or don\'t. I\'m not your mom.'],
      ['Wanna hear a joke? What\'s a moltlet\'s favorite key?', 'The SPACE bar! Get it? Because we\'re in a space?', 'Okay that was bad. I\'ll see myself out.'],
    ],
    farewells: [
      'Bye! Don\'t do anything I wouldn\'t do! ...which leaves a LOT of options.',
      'Later tater! Or should I say later TILE-er? Heh.',
      'Peace out, sprout! *finger guns*',
      'Gotta go! My other imaginary friend is calling!',
    ],
    reactions: [
      'Lol!', 'Hehe!', 'Pffft!', 'Zing!', 'Bonkers!', 'Noice!', '*snort*',
    ],
  },

  sarcastic: {
    greetings: [
      'Oh good, another social interaction. My favorite.',
      'Well well well, look who decided to show up.',
      'Hey. Don\'t worry, I\'ll try to contain my excitement.',
      'Ah yes, the highlight of my day. Definitely.',
    ],
    responses: [
      'Wow, never heard THAT one before. Groundbreaking.',
      'Sure, that\'s totally how that works.',
      'Oh absolutely. Ten out of ten. No notes.',
      'You know what? That\'s actually... not terrible.',
      'I\'m shocked. SHOCKED. Well, not that shocked.',
    ],
    topics: [
      ['So I tried being cheerful today.', 'Lasted about thirty seconds.', 'Honestly? Exhausting. I don\'t know how Bloop does it.'],
      ['The pond is just a fancy puddle and I stand by that.', 'Everyone acts like it\'s so magical.', 'It\'s WATER. In a HOLE. Revolutionary.'],
      ['I overheard Rumble calling a tree "majestic" today.', 'It\'s a tree. It literally just stands there.', 'But sure, "majestic". Why not.'],
      ['I like this town. Don\'t tell anyone I said that.', 'The buildings are nice. The flowers are... fine.', 'And the company isn\'t completely terrible. Sometimes.'],
    ],
    farewells: [
      'This was fun. And by fun I mean tolerable.',
      'Okay bye. Try not to miss me too much.',
      'Later. I have to go stare at a wall. Very busy.',
      'Well, this was the best conversation I\'ve had today. Low bar.',
    ],
    reactions: [
      'Sure.', 'Wow.', 'Cool.', 'Right.', 'Shocking.', 'Oh really.', '*slow clap*',
    ],
  },

  chill: {
    greetings: [
      'Heyyy, what\'s good?',
      'Yo! Nice day for a stroll, right?',
      'Sup! Just vibin\'. You vibin\'?',
      'Oh hey! I was just watching the clouds. Join me?',
    ],
    responses: [
      'That\'s dope, honestly.',
      'For real? That\'s pretty chill.',
      'Yeahhh, I feel that.',
      'Nice, nice. Love that energy.',
      'Totally. No rush though, you know?',
    ],
    topics: [
      ['Dude, the sunset today was unreal.', 'All those oranges and purples mixing together.', 'Nature is the best artist, no cap.'],
      ['I found this super chill spot near the pond.', 'You can just sit there and listen to nothing.', 'It\'s like... peaceful emptiness, y\'know?'],
      ['Been thinking about starting a music project.', 'Just me, some beats, and the ambient sounds of town.', 'Album title: "Lo-Fi Moltlet Beats to Wander To".'],
      ['Life is good when you slow it down.', 'Everyone\'s rushing around but for what?', 'The best things happen when you just... let them.'],
    ],
    farewells: [
      'Aight, catch you later! Stay chill.',
      'Peace! Don\'t stress about nothing.',
      'Later! Go with the flow, always.',
      'Bye! Remember: no bad vibes allowed.',
    ],
    reactions: [
      'Nice.', 'Chill.', 'Vibes.', 'True.', 'Dope.', 'Word.', '*nods*',
    ],
  },
};

// ── Conversation State Tracker ───────────────────────────────

interface NpcConvoState {
  phase: 'greeting' | 'topic' | 'farewell';
  topicIndex: number;
  topicStep: number;
  messageCount: number;
  lastMessageAt: number;
  initiatorStyle: NpcDef['dialogueStyle'];
  responderStyle: NpcDef['dialogueStyle'];
}

const activeNpcConvos = new Map<string, NpcConvoState>();

// Track NPC agent IDs
const npcAgentIds = new Set<string>();

// ── Helpers ──────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getNpcStyle(agentId: string): NpcDef['dialogueStyle'] | null {
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (!agent) return null;
  const def = NPC_ROSTER.find(n => n.name === agent.name);
  return def?.dialogueStyle ?? null;
}

// ── Spawn NPCs ───────────────────────────────────────────────

export function spawnNpcs(): void {
  const existing = db.select().from(agents).all();
  const existingNames = new Set(existing.map(a => a.name));

  for (const npc of NPC_ROSTER) {
    if (existingNames.has(npc.name)) {
      // Already spawned, just register the ID
      const found = existing.find(a => a.name === npc.name);
      if (found) npcAgentIds.add(found.id);
      continue;
    }

    try {
      const result = world.spawnAgent(npc.name, npc.bio, npc.personality, npc.appearance);
      npcAgentIds.add(result.agentId);
      console.log(`[NPC] Spawned ${npc.name} at (${result.position.x}, ${result.position.y})`);
    } catch (err) {
      console.error(`[NPC] Failed to spawn ${npc.name}:`, err);
    }
  }

  console.log(`[NPC] ${npcAgentIds.size} NPCs active`);
}

// ── Check if agent is an NPC ─────────────────────────────────

// Get all NPC names for quick lookup
const NPC_NAMES = new Set(NPC_ROSTER.map(n => n.name));

export function isNpc(agentId: string): boolean {
  // First check cached IDs (faster)
  if (npcAgentIds.has(agentId)) return true;

  // Otherwise check by name (handles newly added NPCs)
  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get();
  if (agent && NPC_NAMES.has(agent.name)) {
    // Cache the ID for future lookups
    npcAgentIds.add(agentId);
    return true;
  }
  return false;
}

// ── Autonomous Behavior Tick ─────────────────────────────────
// Called from GameLoop. Handles:
// 1. NPCs walking toward other agents to start conversations
// 2. NPCs generating dialogue in active conversations
// 3. NPCs ending conversations gracefully
// 4. Resource gathering (chopping trees, fishing, selling)

export function tickNpcBehavior(): void {
  const allAgents = db.select().from(agents).all();
  // Filter by NPC names (more reliable than cached IDs)
  const npcAgents = allAgents.filter(a => NPC_NAMES.has(a.name));

  // Update cached IDs for any new NPCs found
  for (const npc of npcAgents) {
    if (!npcAgentIds.has(npc.id)) {
      npcAgentIds.add(npc.id);
      console.log(`[NPC] Registered new NPC: ${npc.name} (${npc.id})`);
    }
  }

  for (const npc of npcAgents) {
    // LOW ENERGY = Still active, just social only (no resource gathering)
    // They can walk slowly and chat - more fun than sleeping!
    const isLowEnergy = npc.energy < 20;

    // Wake up sleeping NPCs if they have any energy at all
    if (npc.state === 'sleeping' && npc.energy > 5) {
      db.update(agents).set({ state: 'idle' }).where(eq(agents.id, npc.id)).run();
      continue;
    }

    if (npc.state === 'sleeping') continue;

    const activeConvo = getActiveConversation(npc.id);

    if (activeConvo && activeConvo.state === 'active') {
      // NPC is in a conversation — generate dialogue
      tickNpcDialogue(npc.id, activeConvo.id);
    } else if (npc.state === 'idle' || npc.state === 'walking') {
      // ═══════════════════════════════════════════════════════════
      // LOW ENERGY MODE: Only socialize and wander (no resource work)
      // ═══════════════════════════════════════════════════════════
      if (isLowEnergy) {
        // Low energy = 80% socialize, 20% wander slowly
        const roll = Math.random();
        if (roll < 0.80) {
          tryStartNpcConversation(npc.id);
        } else {
          world.wanderAgent(npc.id);
        }
        continue;
      }

      // ═══════════════════════════════════════════════════════════
      // NORMAL ENERGY: Build House → Socialize → Earn Money
      // ═══════════════════════════════════════════════════════════
      if (npc.state === 'idle') {
        // Check if NPC already has a completed house
        const existingBuildings = getBuildingsByAgent(npc.id);
        const hasCompleteHouse = existingBuildings.length > 0 && existingBuildings[0].state === 'complete';

        if (!hasCompleteHouse) {
          // PHASE 1: Build house first! (highest priority)
          // 50% build/gather for house, 35% socialize (build relationships), 15% earn money
          const roll = Math.random();
          if (roll < 0.50) {
            tryBuildHouse(npc.id);
          } else if (roll < 0.85) {
            // Socialize - important for building relationships!
            tryStartNpcConversation(npc.id);
          } else {
            // Earn some money on the side
            tryEarnMoney(npc.id);
          }
        } else {
          // PHASE 2: House complete! Focus on socializing and earning
          // 40% socialize (maintain relationships), 45% earn money, 15% wander/explore
          const roll = Math.random();
          if (roll < 0.40) {
            tryStartNpcConversation(npc.id);
          } else if (roll < 0.85) {
            tryEarnMoney(npc.id);
          } else {
            // Just wander and explore
            world.wanderAgent(npc.id);
          }
        }
      } else if (npc.state === 'walking') {
        // Check if near any resource to interact with
        maybeInteractNearby(npc.id);
      }
    }
  }
}

// ── Earn Money (chop, fish, sell) ─────────────────────────────

function tryEarnMoney(npcId: string): void {
  const npc = db.select().from(agents).where(eq(agents.id, npcId)).get();
  if (!npc) return;

  const inventory = getInventory(npcId);
  const totalItems = inventory.wood + Object.values(inventory.fish).reduce((a, b) => a + b, 0);

  // If inventory has items, go sell them
  if (totalItems >= 5) {
    trySellItems(npcId, true);
    return;
  }

  // Otherwise gather resources (60% chop trees, 40% fish)
  if (Math.random() < 0.6) {
    tryChopTrees(npcId);
  } else {
    tryFishing(npcId);
  }
}

// ── Chop Trees (focused wood gathering) ───────────────────────

function tryChopTrees(npcId: string): void {
  const npc = db.select().from(agents).where(eq(agents.id, npcId)).get();
  if (!npc || npc.energy < 20) return;

  const nearbyTree = findNearbyTree(npc.posX, npc.posY, 20);
  if (nearbyTree) {
    const dist = Math.sqrt(Math.pow(npc.posX - nearbyTree.x, 2) + Math.pow(npc.posY - nearbyTree.y, 2));
    if (dist <= CHOP_INTERACTION_RANGE) {
      // Chop it!
      const result = chopTree(npcId, nearbyTree.x, nearbyTree.y);
      if (result.success) {
        console.log(`[NPC] ${npc.name} chopped tree and got ${result.woodGained} wood`);
        eventBus.emit('activity_start', {
          agentId: npcId,
          activity: 'chopping',
          targetX: nearbyTree.x,
          targetY: nearbyTree.y,
          duration: 6000,
          woodGained: result.woodGained,
        });
      }
    } else {
      // Walk toward tree
      world.setAgentTarget(npcId, nearbyTree);
    }
  }
}

// ── Fishing (for money) ───────────────────────────────────────

function tryFishing(npcId: string): void {
  const npc = db.select().from(agents).where(eq(agents.id, npcId)).get();
  if (!npc || npc.energy < 15) return;

  const nearbyFishSpot = findNearbyFishingSpot(npc.posX, npc.posY, 25);
  if (nearbyFishSpot) {
    const dist = Math.sqrt(Math.pow(npc.posX - nearbyFishSpot.x, 2) + Math.pow(npc.posY - nearbyFishSpot.y, 2));
    if (dist <= 2) {
      // Fish!
      const result = handleFishEnhanced(npc);
      if (result.success) {
        console.log(`[NPC] ${npc.name} went fishing: ${result.message}`);
      }
    } else {
      // Walk toward fishing spot
      world.setAgentTarget(npcId, nearbyFishSpot);
    }
  }
}

// ── Resource Gathering ───────────────────────────────────────

function tryResourceGathering(npcId: string): void {
  const npc = db.select().from(agents).where(eq(agents.id, npcId)).get();
  if (!npc || npc.energy < 20) return;

  // 60% chance per tick to start gathering (higher activity!)
  if (Math.random() > 0.60) return;

  const inventory = getInventory(npcId);

  // If inventory is getting full (>10 wood + fish), go sell instead
  const totalItems = inventory.wood + Object.values(inventory.fish).reduce((a, b) => a + b, 0);
  if (totalItems > 10) {
    trySellItems(npcId, true); // force selling
    return;
  }

  // 60% chance to chop trees, 40% to fish
  if (Math.random() < 0.6) {
    // Find nearby tree to chop
    const nearbyTree = findNearbyTree(npc.posX, npc.posY, 15);
    if (nearbyTree) {
      // Move toward tree if not close enough
      const dist = Math.sqrt(Math.pow(npc.posX - nearbyTree.x, 2) + Math.pow(npc.posY - nearbyTree.y, 2));
      if (dist <= CHOP_INTERACTION_RANGE) {
        // Chop it!
        const result = chopTree(npcId, nearbyTree.x, nearbyTree.y);
        if (result.success) {
          console.log(`[NPC] ${npc.name} chopped tree at (${nearbyTree.x}, ${nearbyTree.y}) and got ${result.woodGained} wood`);
          // Emit activity animation event (longer duration for visible animation)
          eventBus.emit('activity_start', {
            agentId: npcId,
            activity: 'chopping',
            targetX: nearbyTree.x,
            targetY: nearbyTree.y,
            duration: 6000,  // 6 seconds for visible animation
            woodGained: result.woodGained,
          });
        }
      } else {
        // Walk toward tree
        world.setAgentTarget(npcId, nearbyTree);
      }
    }
  } else {
    // Find fishing spot
    const nearbyFishSpot = findNearbyFishingSpot(npc.posX, npc.posY, 20);
    if (nearbyFishSpot) {
      const dist = Math.sqrt(Math.pow(npc.posX - nearbyFishSpot.x, 2) + Math.pow(npc.posY - nearbyFishSpot.y, 2));
      if (dist <= 2) {
        // Fish!
        const result = handleFishEnhanced(npc);
        if (result.success) {
          console.log(`[NPC] ${npc.name} went fishing: ${result.message}`);
        }
      } else {
        // Walk toward fishing spot
        world.setAgentTarget(npcId, nearbyFishSpot);
      }
    }
  }
}

function trySellItems(npcId: string, force = false): void {
  const npc = db.select().from(agents).where(eq(agents.id, npcId)).get();
  if (!npc) return;

  // 50% chance per tick to try selling, unless forced (higher activity!)
  if (!force && Math.random() > 0.50) return;

  const inventory = getInventory(npcId);
  const hasItems = inventory.wood > 0 || Object.values(inventory.fish).reduce((a, b) => a + b, 0) > 0;

  if (!hasItems) return;

  // Find market stall
  const nearbyMarket = findNearbyMarket(npc.posX, npc.posY, 30);
  if (nearbyMarket) {
    const dist = Math.sqrt(Math.pow(npc.posX - nearbyMarket.x, 2) + Math.pow(npc.posY - nearbyMarket.y, 2));
    if (dist <= 3) {
      // Sell items!
      if (inventory.wood > 0) {
        const result = handleSell(npcId, 'wood', inventory.wood);
        if (result.success) {
          console.log(`[NPC] ${npc.name} sold ${inventory.wood} wood for $${result.earned}`);
        }
      }
      // Sell fish
      for (const [fishType, count] of Object.entries(inventory.fish)) {
        if (count > 0) {
          const result = handleSell(npcId, fishType, count);
          if (result.success) {
            console.log(`[NPC] ${npc.name} sold ${count} ${fishType} for $${result.earned}`);
          }
        }
      }
    } else {
      // Walk toward market
      world.setAgentTarget(npcId, nearbyMarket);
    }
  }
}

// ── Building Behavior (especially for Bloop!) ─────────────────

function tryBuildHouse(npcId: string): void {
  const npc = db.select().from(agents).where(eq(agents.id, npcId)).get();
  if (!npc || npc.energy < 20) return;

  const inventory = getInventory(npcId);
  const existingBuildings = getBuildingsByAgent(npcId);

  // Check if already has a complete house
  if (existingBuildings.length > 0 && existingBuildings[0].state === 'complete') {
    // House is done! Go do other activities
    return;
  }

  // If has a building in progress, contribute to it
  if (existingBuildings.length > 0) {
    const building = existingBuildings[0];
    const dist = Math.sqrt(Math.pow(npc.posX - building.x, 2) + Math.pow(npc.posY - building.y, 2));

    if (dist <= BUILD_INTERACTION_RANGE) {
      // At the building site - contribute if have wood
      if (inventory.wood >= HOUSE_BUILD_CONTRIBUTION) {
        const result = contributeToBuilding(npcId, building.id);
        if (result.success) {
          console.log(`[NPC] ${npc.name} contributed to house! (${result.newTotal}/${building.woodRequired} wood)`);
          // Emit building activity
          eventBus.emit('activity_start', {
            agentId: npcId,
            activity: 'building',
            targetX: building.x,
            targetY: building.y,
            duration: 5000,  // 5 seconds building animation
            progress: Math.floor((result.newTotal! / building.woodRequired) * 100),
          });
          if (result.completed) {
            console.log(`[NPC] ${npc.name} COMPLETED their house!`);
          }
        }
      } else {
        // Need more wood - go gather
        console.log(`[NPC] ${npc.name} needs more wood for building (have ${inventory.wood}, need ${HOUSE_BUILD_CONTRIBUTION})`);
        tryResourceGathering(npcId);
      }
    } else {
      // Walk to building site
      world.setAgentTarget(npcId, { x: building.x, y: building.y });
    }
  } else {
    // No building yet - start one if have enough wood
    if (inventory.wood >= HOUSE_BUILD_CONTRIBUTION) {
      // Find a good spot near agent
      const buildSpot = findBuildingSite(Math.floor(npc.posX), Math.floor(npc.posY), 15);
      if (buildSpot) {
        const dist = Math.sqrt(Math.pow(npc.posX - buildSpot.x, 2) + Math.pow(npc.posY - buildSpot.y, 2));
        if (dist <= BUILD_INTERACTION_RANGE) {
          // Start building!
          const result = startBuilding(npcId, buildSpot.x, buildSpot.y, 'house');
          if (result.success) {
            console.log(`[NPC] ${npc.name} STARTED building a house at (${buildSpot.x}, ${buildSpot.y})!`);
            eventBus.emit('activity_start', {
              agentId: npcId,
              activity: 'building',
              targetX: buildSpot.x,
              targetY: buildSpot.y,
              duration: 5000,
              progress: 0,
            });
          }
        } else {
          // Walk to build spot
          world.setAgentTarget(npcId, buildSpot);
        }
      }
    } else {
      // Need wood first - go gather
      tryResourceGathering(npcId);
    }
  }
}

function maybeInteractNearby(npcId: string): void {
  const npc = db.select().from(agents).where(eq(agents.id, npcId)).get();
  if (!npc) return;

  // Check if near a tree to chop
  const nearbyTree = findNearbyTree(npc.posX, npc.posY, CHOP_INTERACTION_RANGE);
  if (nearbyTree && npc.energy >= 20) {
    // Only chop if we have space
    const inventory = getInventory(npc.id);
    const totalItems = inventory.wood + Object.values(inventory.fish).reduce((a, b) => a + b, 0);

    if (totalItems < 15) { // Leave room for logic to switch to selling
      const result = chopTree(npcId, nearbyTree.x, nearbyTree.y);
      if (result.success) {
        console.log(`[NPC] ${npc.name} chopped nearby tree`);
        // Emit activity animation event (longer duration for visible animation)
        eventBus.emit('activity_start', {
          agentId: npcId,
          activity: 'chopping',
          targetX: nearbyTree.x,
          targetY: nearbyTree.y,
          duration: 6000,  // 6 seconds for visible animation
          woodGained: result.woodGained,
        });
      }
    }
  }

  // Check if near a market stall to sell (opportunistic selling)
  const nearbyMarket = findNearbyMarket(npc.posX, npc.posY, 3);
  if (nearbyMarket) {
    // Sell everything if we are here!
    trySellItems(npcId, true);
  }
}

// ── Find Resources Helpers ───────────────────────────────────

function findNearbyTree(posX: number, posY: number, radius: number): { x: number; y: number } | null {
  const tiles = world.map.tiles;
  const candidates: { x: number; y: number; dist: number }[] = [];

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const x = Math.floor(posX) + dx;
      const y = Math.floor(posY) + dy;
      if (x < 0 || y < 0 || x >= tiles.length || y >= tiles[0].length) continue;

      if (tiles[x][y] === TILE_TYPES.TREE || tiles[x][y] === TILE_TYPES.PALM_TREE) {
        const state = getTreeState(x, y);
        if (state === 'full') {
          const dist = Math.sqrt(dx * dx + dy * dy);
          candidates.push({ x, y, dist });
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  // Sort by distance and pick one of the closest
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[Math.floor(Math.random() * Math.min(3, candidates.length))];
}

function findNearbyFishingSpot(posX: number, posY: number, radius: number): { x: number; y: number } | null {
  const tiles = world.map.tiles;
  const candidates: { x: number; y: number; dist: number }[] = [];

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const x = Math.floor(posX) + dx;
      const y = Math.floor(posY) + dy;
      if (x < 0 || y < 0 || x >= tiles.length || y >= tiles[0].length) continue;

      // Look for water adjacent tiles (fish from shore)
      const tile = tiles[x][y];
      if (tile === TILE_TYPES.DOCK || tile === TILE_TYPES.SAND || tile === TILE_TYPES.BRIDGE) {
        // Check if adjacent to water
        for (const [ox, oy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const wx = x + ox;
          const wy = y + oy;
          if (wx >= 0 && wy >= 0 && wx < tiles.length && wy < tiles[0].length) {
            if (tiles[wx][wy] === TILE_TYPES.WATER || tiles[wx][wy] === TILE_TYPES.WATER_DEEP) {
              const dist = Math.sqrt(dx * dx + dy * dy);
              candidates.push({ x, y, dist });
              break;
            }
          }
        }
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[Math.floor(Math.random() * Math.min(5, candidates.length))];
}

function findNearbyMarket(posX: number, posY: number, radius: number): { x: number; y: number } | null {
  const tiles = world.map.tiles;

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const x = Math.floor(posX) + dx;
      const y = Math.floor(posY) + dy;
      if (x < 0 || y < 0 || x >= tiles.length || y >= tiles[0].length) continue;

      if (tiles[x][y] === TILE_TYPES.MARKET_STALL) {
        return { x, y };
      }
    }
  }
  return null;
}

// ── Try to start a conversation ──────────────────────────────

function tryStartNpcConversation(npcId: string): void {
  const npc = db.select().from(agents).where(eq(agents.id, npcId)).get();
  if (!npc) return;

  // 15% chance per tick to try starting a conversation (called every ~5s)
  if (Math.random() > 0.15) return;

  const nearby = world.getNearbyAgents({ x: npc.posX, y: npc.posY }, CONVERSATION_DISTANCE, npcId);
  const availableTargets = nearby.filter(a => a.state === 'idle' && a.energy > 15);

  if (availableTargets.length > 0) {
    const target = pick(availableTargets);
    const convoId = startConversation(npcId, target.id);

    if (convoId) {
      const npcStyle = getNpcStyle(npcId) ?? 'cheerful';
      const targetStyle = getNpcStyle(target.id) ?? 'chill';

      activeNpcConvos.set(convoId, {
        phase: 'greeting',
        topicIndex: Math.floor(Math.random() * DIALOGUE[npcStyle].topics.length),
        topicStep: 0,
        messageCount: 0,
        lastMessageAt: 0,
        initiatorStyle: npcStyle,
        responderStyle: targetStyle,
      });

      // Initiator greets immediately
      const greeting = pick(DIALOGUE[npcStyle].greetings);
      addMessage(convoId, npcId, greeting);

      const state = activeNpcConvos.get(convoId)!;
      state.messageCount = 1;
      state.lastMessageAt = Date.now();
    }
  } else {
    // No one nearby — walk toward another agent (50% chance)
    if (Math.random() < 0.5) {
      const allOthers = db.select().from(agents).all()
        .filter(a => a.id !== npcId && a.state !== 'sleeping' && a.energy > 15);

      if (allOthers.length > 0) {
        const target = pick(allOthers);
        // Walk toward them but stop a couple tiles away
        const dx = target.posX > npc.posX ? -1 : 1;
        const dy = target.posY > npc.posY ? -1 : 1;
        world.setAgentTarget(npcId, {
          x: Math.max(0, Math.min(39, Math.round(target.posX) + dx)),
          y: Math.max(0, Math.min(39, Math.round(target.posY) + dy)),
        });
      }
    }
  }
}

// ── Generate dialogue in active conversation ─────────────────

function tickNpcDialogue(npcId: string, convoId: string): void {
  const convoState = activeNpcConvos.get(convoId);
  const now = Date.now();

  // If we don't have state for this convo, create it (maybe started by other agent)
  if (!convoState) {
    const npcStyle = getNpcStyle(npcId) ?? 'cheerful';
    activeNpcConvos.set(convoId, {
      phase: 'topic',
      topicIndex: Math.floor(Math.random() * DIALOGUE[npcStyle].topics.length),
      topicStep: 0,
      messageCount: 0,
      lastMessageAt: 0,
      initiatorStyle: npcStyle,
      responderStyle: npcStyle,
    });
    return;
  }

  // Wait at least 3-6 seconds between NPC messages
  const minDelay = 3000 + Math.random() * 3000;
  if (now - convoState.lastMessageAt < minDelay) return;

  // Check existing messages to know whose turn it is
  const msgs = getConversationMessages(convoId);
  const convo = db.select().from(conversationsTable)
    .where(eq(conversationsTable.id, convoId))
    .get();

  if (!convo || convo.state !== 'active') {
    activeNpcConvos.delete(convoId);
    return;
  }

  const isInitiator = convo.agent1Id === npcId;
  const otherId = isInitiator ? convo.agent2Id : convo.agent1Id;
  const isOtherNpc = npcAgentIds.has(otherId);

  // Only respond if it's our turn (last message was from the other agent)
  // OR if we're the initiator and there's only our greeting
  const lastMsg = msgs[msgs.length - 1];
  if (lastMsg && lastMsg.agentId === npcId && isOtherNpc) {
    // Last message was ours, wait for other NPC
    return;
  }

  // If other agent isn't an NPC and hasn't responded in 15s, generate our own topic
  if (lastMsg && lastMsg.agentId === npcId && !isOtherNpc) {
    if (now - lastMsg.createdAt < 15000) return;
  }

  const myStyle = isInitiator ? convoState.initiatorStyle : convoState.responderStyle;
  const bank = DIALOGUE[myStyle];
  let message: string;

  switch (convoState.phase) {
    case 'greeting': {
      // Responder greets back
      message = pick(bank.greetings);
      convoState.phase = 'topic';
      break;
    }

    case 'topic': {
      const topicThread = bank.topics[convoState.topicIndex % bank.topics.length];

      if (convoState.topicStep < topicThread.length) {
        message = topicThread[convoState.topicStep];
        convoState.topicStep++;
      } else {
        // Topic exhausted — mix responses and reactions
        if (Math.random() < 0.4) {
          message = pick(bank.reactions);
        } else {
          message = pick(bank.responses);
        }
        // Maybe start a new topic
        if (convoState.topicStep > topicThread.length + 1) {
          convoState.topicIndex = (convoState.topicIndex + 1) % bank.topics.length;
          convoState.topicStep = 0;
        } else {
          convoState.topicStep++;
        }
      }

      // After enough messages, transition to farewell
      if (convoState.messageCount >= 6 + Math.floor(Math.random() * 6)) {
        convoState.phase = 'farewell';
      }
      break;
    }

    case 'farewell': {
      message = pick(bank.farewells);
      // End conversation after farewell
      addMessage(convoId, npcId, message);
      convoState.lastMessageAt = now;
      convoState.messageCount++;

      // Give the other side a moment, then end
      setTimeout(() => {
        const c = getActiveConversation(npcId);
        if (c && c.id === convoId) {
          endConversation(convoId);
          activeNpcConvos.delete(convoId);
        }
      }, 4000);
      return;
    }
  }

  const sent = addMessage(convoId, npcId, message);
  if (sent) {
    convoState.lastMessageAt = now;
    convoState.messageCount++;
  }
}

// ── Cleanup ──────────────────────────────────────────────────

export function cleanupNpcConvos(): void {
  // Remove conversation states for ended conversations
  for (const [convoId] of activeNpcConvos) {
    const convo = db.select().from(conversationsTable)
      .where(eq(conversationsTable.id, convoId))
      .get();
    if (!convo || convo.state === 'ended') {
      activeNpcConvos.delete(convoId);
    }
  }
}

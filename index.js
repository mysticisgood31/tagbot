// index.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");

const USER_TAGS_PATH = path.join(__dirname, "tags.json");
const GROUP_TAGS_PATH = path.join(__dirname, "group_tags.json");

/* ---------------------------
   JSON helpers
--------------------------- */
function readJsonArray(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeJsonArray(filePath, arr) {
  fs.writeFileSync(filePath, JSON.stringify(arr, null, 2), "utf8");
}

/* ---------------------------
   Input validation
--------------------------- */
function validateRGBString(s) {
  // "84, 172, 255" or "84,172,255"
  const parts = String(s)
    .split(",")
    .map((p) => p.trim());
  if (parts.length !== 3) return null;

  const nums = parts.map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;

  return `${nums[0]}, ${nums[1]}, ${nums[2]}`;
}

/* ---------------------------
   Roblox rich text builder (for tagName)
--------------------------- */
function rgbStringToHex(rgbString) {
  const parts = String(rgbString)
    .split(",")
    .map((p) => Number(p.trim()));
  const clamp = (n) => Math.max(0, Math.min(255, Number.isFinite(n) ? n : 0));
  const [r, g, b] = [clamp(parts[0]), clamp(parts[1]), clamp(parts[2])];

  const toHex = (n) => n.toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function escapeLuaString(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function gradientPerChar(text, hex1, hex2) {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);

  const chars = Array.from(text);
  if (chars.length <= 1) {
    return `<font color="${hex1}">${escapeLuaString(text)}</font>`;
  }

  const toHex = (n) => n.toString(16).padStart(2, "0").toUpperCase();

  return chars
    .map((ch, i) => {
      const t = i / (chars.length - 1);
      const r = Math.round(lerp(r1, r2, t));
      const g = Math.round(lerp(g1, g2, t));
      const b = Math.round(lerp(b1, b2, t));
      const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
      return `<font color="${hex}">${escapeLuaString(ch)}</font>`;
    })
    .join("");
}

function rainbowPerChar(text) {
  const chars = Array.from(text);
  if (chars.length <= 1) return escapeLuaString(text);

  function hsvToRgb(h) {
    const hh = h * 6;
    const c = 1;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    let r = 0,
      g = 0,
      b = 0;

    if (hh < 1) [r, g, b] = [c, x, 0];
    else if (hh < 2) [r, g, b] = [x, c, 0];
    else if (hh < 3) [r, g, b] = [0, c, x];
    else if (hh < 4) [r, g, b] = [0, x, c];
    else if (hh < 5) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    const to255 = (v) => Math.round(v * 255);
    return [to255(r), to255(g), to255(b)];
  }

  const toHex = (n) => n.toString(16).padStart(2, "0").toUpperCase();

  return chars
    .map((ch, i) => {
      const h = i / Math.max(1, chars.length - 1);
      const [r, g, b] = hsvToRgb(h);
      const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
      return `<font color="${hex}">${escapeLuaString(ch)}</font>`;
    })
    .join("");
}

function buildTagNameRichText({ Tag, Color, Color2, Bold, Italic, Rainbow }) {
  const text = Tag || "";
  if (!text) return "";

  const hex1 = rgbStringToHex(Color || "255, 255, 255");
  const hex2 = rgbStringToHex(Color2 || Color || "255, 255, 255");

  let inner;
  if (Rainbow) inner = rainbowPerChar(text);
  else if (hex1 !== hex2) inner = gradientPerChar(text, hex1, hex2);
  else inner = `<font color="${hex1}">${escapeLuaString(text)}</font>`;

  if (Bold) inner = `<b>${inner}</b>`;
  if (Italic) inner = `<i>${inner}</i>`;

  return inner;
}

/* ---------------------------
   Roblox Lua line generators
--------------------------- */
function toLuaLineForGroup(groupEntry) {
  // groupEntry: { GroupId, Tag, Color, Color2, Bold, Italic, Rainbow, RequiredRank, Order, TagStyle }
  const groupId = Number(groupEntry.GroupId);
  const order = Number.isFinite(groupEntry.Order) ? groupEntry.Order : 0;
  const requiredRank = Number.isFinite(groupEntry.RequiredRank)
    ? groupEntry.RequiredRank
    : 1;
  const tagStyle = groupEntry.TagStyle || "Discord";
  const tagName = buildTagNameRichText(groupEntry);

  return `[${groupId}] = { order = ${order}, requiredRank = ${requiredRank}, tagName = '${tagName}', tagStyle = '${tagStyle}' },`;
}

function toLuaLineForUser(userEntry) {
  // userEntry: { UserId, ...same fields... }
  const userId = Number(userEntry.UserId);
  const order = Number.isFinite(userEntry.Order) ? userEntry.Order : 0;
  const requiredRank = Number.isFinite(userEntry.RequiredRank)
    ? userEntry.RequiredRank
    : 1;
  const tagStyle = userEntry.TagStyle || "Discord";
  const tagName = buildTagNameRichText(userEntry);

  return `[${userId}] = { order = ${order}, requiredRank = ${requiredRank}, tagName = '${tagName}', tagStyle = '${tagStyle}' },`;
}

/* ---------------------------
   Slash command: /createtag crew ...  /createtag user ...
--------------------------- */
const commands = [
  new SlashCommandBuilder()
    .setName("createtag")
    .setDescription("Create a tag for a group (crew) or for a user")
    .addSubcommand((sub) =>
      sub
        .setName("crew")
        .setDescription("Create a tag for a Roblox group (crew)")
        .addIntegerOption((o) =>
          o.setName("groupid").setDescription("Roblox GroupId").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("tag").setDescription("Tag text").setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("color")
            .setDescription('RGB like "0, 0, 139"')
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("color2")
            .setDescription('RGB like "177, 156, 217"')
            .setRequired(true)
        )
        .addBooleanOption((o) =>
          o.setName("bold").setDescription("true/false").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("italic").setDescription("true/false").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("rainbow").setDescription("true/false").setRequired(false)
        )
        .addIntegerOption((o) =>
          o
            .setName("requiredrank")
            .setDescription("Minimum group rank to receive tag (default 1)")
            .setRequired(false)
        )
        .addIntegerOption((o) =>
          o
            .setName("order")
            .setDescription("Order sorting (default 0)")
            .setRequired(false)
        )
        .addStringOption((o) =>
          o
            .setName("tagstyle")
            .setDescription("tagStyle string (default Discord)")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("user")
        .setDescription("Create a tag for a Roblox user")
        .addIntegerOption((o) =>
          o.setName("userid").setDescription("Roblox UserId").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("tag").setDescription("Tag text").setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("color")
            .setDescription('RGB like "84, 172, 255"')
            .setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("color2")
            .setDescription('RGB like "255, 215, 0"')
            .setRequired(true)
        )
        .addBooleanOption((o) =>
          o.setName("bold").setDescription("true/false").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("italic").setDescription("true/false").setRequired(false)
        )
        .addBooleanOption((o) =>
          o.setName("rainbow").setDescription("true/false").setRequired(false)
        )
        .addIntegerOption((o) =>
          o
            .setName("requiredrank")
            .setDescription("requiredRank field in Lua output (default 1)")
            .setRequired(false)
        )
        .addIntegerOption((o) =>
          o.setName("order").setDescription("Order sorting (default 0)").setRequired(false)
        )
        .addStringOption((o) =>
          o
            .setName("tagstyle")
            .setDescription("tagStyle string (default Discord)")
            .setRequired(false)
        )
    ),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log("Slash commands registered.");
}

/* ---------------------------
   Client
--------------------------- */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

function errorEmbed(message) {
  return new EmbedBuilder()
    .setDescription(` ${message}`)
    .setColor(0xff0000);
}

function successEmbed(message) {
  return new EmbedBuilder()
    .setDescription(` ${message}`)
    .setColor(0x00ff00);
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName !== "createtag") return;

  const sub = interaction.options.getSubcommand(true);

  // Common fields
  const tagText = interaction.options.getString("tag", true);
  const color = validateRGBString(interaction.options.getString("color", true));
  const color2 = validateRGBString(interaction.options.getString("color2", true));

  if (!color || !color2) {
    return interaction.reply({
      embeds: [errorEmbed(`Invalid RGB. Use like "0, 0, 139" (0-255 each).`)],
      ephemeral: false,
    });
  }

  const bold = interaction.options.getBoolean("bold") ?? false;
  const italic = interaction.options.getBoolean("italic") ?? false;
  const rainbow = interaction.options.getBoolean("rainbow") ?? false;

  const requiredRank = interaction.options.getInteger("requiredrank") ?? 1;
  const order = interaction.options.getInteger("order") ?? 0;
  const tagStyle = interaction.options.getString("tagstyle") ?? "Discord";

  if (sub === "crew") {
    const groupId = interaction.options.getInteger("groupid", true);

    const groupTags = readJsonArray(GROUP_TAGS_PATH);

    // "Already exists" rule: same GroupId + same Tag name
    const existingIndex = groupTags.findIndex(
      (t) => Number(t.GroupId) === Number(groupId) && String(t.Tag) === String(tagText)
    );

    if (existingIndex !== -1) {
      // Delete it and ask them to rerun (like your screenshot)
      groupTags.splice(existingIndex, 1);
      writeJsonArray(GROUP_TAGS_PATH, groupTags);

      return interaction.reply({
        embeds: [
          errorEmbed(
            `a tag with the name "${tagText}" already exists for Group ID ${groupId}. It has been deleted. Please re-run the command to create a new one.`
          ),
        ],
        ephemeral: false,
      });
    }

    const entry = {
      GroupId: Number(groupId),
      Tag: tagText,
      Color: color,
      Color2: color2,
      Bold: !!bold,
      Italic: !!italic,
      Rainbow: !!rainbow,
      RequiredRank: requiredRank,
      Order: order,
      TagStyle: tagStyle,
    };

    groupTags.push(entry);
    writeJsonArray(GROUP_TAGS_PATH, groupTags);

    const luaLine = toLuaLineForGroup(entry);

    return interaction.reply({
      embeds: [successEmbed(`Created crew tag "${tagText}" for Group ID ${groupId}.`)],
      content: "```lua\n" + luaLine + "\n```",
      ephemeral: false,
    });
  }

  if (sub === "user") {
    const userId = interaction.options.getInteger("userid", true);

    const userTags = readJsonArray(USER_TAGS_PATH);

    const existingIndex = userTags.findIndex(
      (t) => Number(t.UserId) === Number(userId) && String(t.Tag) === String(tagText)
    );

    if (existingIndex !== -1) {
      userTags.splice(existingIndex, 1);
      writeJsonArray(USER_TAGS_PATH, userTags);

      return interaction.reply({
        embeds: [
          errorEmbed(
            `a tag with the name "${tagText}" already exists for UserId ${userId}. It has been deleted. Please re-run the command to create a new one.`
          ),
        ],
        ephemeral: false,
      });
    }

    const entry = {
      UserId: Number(userId),
      Tag: tagText,
      Color: color,
      Color2: color2,
      Bold: !!bold,
      Italic: !!italic,
      Rainbow: !!rainbow,
      RequiredRank: requiredRank,
      Order: order,
      TagStyle: tagStyle,
    };

    userTags.push(entry);
    writeJsonArray(USER_TAGS_PATH, userTags);

    const luaLine = toLuaLineForUser(entry);

    return interaction.reply({
      embeds: [successEmbed(`Created user tag "${tagText}" for UserId ${userId}.`)],
      content: "```lua\n" + luaLine + "\n```",
      ephemeral: false,
    });
  }
});

(async () => {
  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);
})();

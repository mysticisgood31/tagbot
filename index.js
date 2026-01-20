
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");


const GROUP_TAGS_PATH = path.join(__dirname, "group_tags.json");


function readJsonObject(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return typeof data === "object" && data !== null && !Array.isArray(data)
      ? data
      : {};
  } catch {
    return {};
  }
}

function writeJsonObject(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

function validateRGBString(s) {
  const parts = String(s).split(",").map((p) => p.trim());
  if (parts.length !== 3) return null;

  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;

  return `${nums[0]}, ${nums[1]}, ${nums[2]}`;
}


function rgbStringToHex(rgb) {
  const p = String(rgb)
    .split(",")
    .map((x) => Number(x.trim()));
  const toHex = (n) => n.toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(p[0] || 0)}${toHex(p[1] || 0)}${toHex(p[2] || 0)}`;
}

function escapeLua(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function gradientText(text, c1, c2) {
  const r1 = parseInt(c1.slice(1, 3), 16);
  const g1 = parseInt(c1.slice(3, 5), 16);
  const b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16);
  const g2 = parseInt(c2.slice(3, 5), 16);
  const b2 = parseInt(c2.slice(5, 7), 16);

  const chars = Array.from(text);
  if (chars.length <= 1) return `<font color="${c1}">${escapeLua(text)}</font>`;

  const toHex = (n) => n.toString(16).padStart(2, "0").toUpperCase();

  return chars
    .map((ch, i) => {
      const t = i / (chars.length - 1);
      const r = Math.round(lerp(r1, r2, t));
      const g = Math.round(lerp(g1, g2, t));
      const b = Math.round(lerp(b1, b2, t));
      const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
      return `<font color="${hex}">${escapeLua(ch)}</font>`;
    })
    .join("");
}

function hsvToHex(h) {

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
  const rr = to255(r);
  const gg = to255(g);
  const bb = to255(b);

  const toHex = (n) => n.toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(rr)}${toHex(gg)}${toHex(bb)}`;
}

function rainbowText(text) {
  const chars = Array.from(text);
  if (chars.length <= 1) return escapeLua(text);

  return chars
    .map((ch, i) => {
      const h = i / Math.max(1, chars.length - 1);
      const hex = hsvToHex(h);
      return `<font color="${hex}">${escapeLua(ch)}</font>`;
    })
    .join("");
}

function buildTagNameRichText(entry) {
  const text = entry.Tag || "";
  if (!text) return "";

  const hex1 = rgbStringToHex(entry.Color || "255, 255, 255");
  const hex2 = rgbStringToHex(entry.Color2 || entry.Color || "255, 255, 255");

  let inner;
  if (entry.Rainbow) inner = rainbowText(text);
  else if (hex1 !== hex2) inner = gradientText(text, hex1, hex2);
  else inner = `<font color="${hex1}">${escapeLua(text)}</font>`;

  if (entry.Bold) inner = `<b>${inner}</b>`;
  if (entry.Italic) inner = `<i>${inner}</i>`;

  return inner;
}


const app = express();

function checkApiKey(req, res, next) {
  const key = process.env.API_KEY;
  if (!key) return next(); 
  if (req.headers["x-api-key"] === key) return next();
  return res.status(401).json({ error: "unauthorized" });
}

app.get("/", (req, res) => res.send("ok"));

app.get("/tags/groups", checkApiKey, (req, res) => {
  const tags = readJsonObject(GROUP_TAGS_PATH);
  res.json(tags);
});


const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log("Web server running on port", PORT));


const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName("createtag")
    .setDescription("Create/update Roblox crew tags (auto-synced to your game)")
    .addSubcommand((sub) =>
      sub
        .setName("crew")
        .setDescription("Create/update a tag for a Roblox Group (crew)")
        .addIntegerOption((o) =>
          o
            .setName("groupid")
            .setDescription("Roblox GroupId")
            .setRequired(true)
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
          o.setName("bold").setDescription("Bold text (true/false)")
        )
        .addBooleanOption((o) =>
          o.setName("italic").setDescription("Italic text (true/false)")
        )
        .addBooleanOption((o) =>
          o.setName("rainbow").setDescription("Rainbow per-letter (true/false)")
        )
    ),
].map((c) => c.toJSON());

function okEmbed(msg) {
  return new EmbedBuilder().setDescription(` ${msg}`).setColor(0x00ff00);
}
function errEmbed(msg) {
  return new EmbedBuilder().setDescription(` ${msg}`).setColor(0xff0000);
}

async function registerCommands() {
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
    throw new Error("Missing DISCORD_TOKEN or CLIENT_ID or GUILD_ID in environment variables.");
  }

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log("Slash commands registered.");
}

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;
  if (i.commandName !== "createtag") return;

  const sub = i.options.getSubcommand(true);
  if (sub !== "crew") return;

  const groupId = i.options.getInteger("groupid", true);
  const tag = i.options.getString("tag", true);

  const color = validateRGBString(i.options.getString("color", true));
  const color2 = validateRGBString(i.options.getString("color2", true));
  if (!color || !color2) {
    return i.reply({
      embeds: [errEmbed('Invalid RGB. Use like "0, 0, 139" (0-255).')],
      ephemeral: true,
    });
  }

  const entry = {
    Tag: tag,
    Color: color,
    Color2: color2,
    Bold: i.options.getBoolean("bold") ?? false,
    Italic: i.options.getBoolean("italic") ?? false,
    Rainbow: i.options.getBoolean("rainbow") ?? false,
  };

  const tags = readJsonObject(GROUP_TAGS_PATH);
  tags[String(groupId)] = {
    order: 0,
    requiredRank: 1,
    tagName: buildTagNameRichText(entry),
    tagStyle: "Discord",
  };
  writeJsonObject(GROUP_TAGS_PATH, tags);

  return i.reply({
    embeds: [okEmbed(`Crew tag saved for Group ID ${groupId}. Roblox will auto-sync.`)],
    ephemeral: false,
  });
});


(async () => {
  try {
    await registerCommands();
    await client.login(process.env.DISCORD_TOKEN);
    console.log("Discord bot online");
  } catch (e) {
    console.error("Startup error:", e);
  }
})();

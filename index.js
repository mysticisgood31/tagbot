
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
    return typeof data === "object" && data !== null ? data : {};
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
  const p = rgb.split(",").map((x) => Number(x.trim()));
  const toHex = (n) => n.toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(p[0])}${toHex(p[1])}${toHex(p[2])}`;
}

function escapeLua(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function gradient(text, c1, c2) {
  const r1 = parseInt(c1.slice(1, 3), 16);
  const g1 = parseInt(c1.slice(3, 5), 16);
  const b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16);
  const g2 = parseInt(c2.slice(3, 5), 16);
  const b2 = parseInt(c2.slice(5, 7), 16);

  const chars = [...text];
  if (chars.length <= 1) return `<font color="${c1}">${escapeLua(text)}</font>`;

  return chars
    .map((ch, i) => {
      const t = i / (chars.length - 1);
      const r = Math.round(lerp(r1, r2, t));
      const g = Math.round(lerp(g1, g2, t));
      const b = Math.round(lerp(b1, b2, t));
      const hex = `#${r.toString(16).padStart(2, "0")}${g
        .toString(16)
        .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      return `<font color="${hex}">${escapeLua(ch)}</font>`;
    })
    .join("");
}

function rainbow(text) {
  const chars = [...text];
  return chars
    .map((ch, i) => {
      const h = i / Math.max(1, chars.length - 1);
      const rgb = hsv(h);
      return `<font color="${rgb}">${escapeLua(ch)}</font>`;
    })
    .join("");
}

function hsv(h) {
  const f = (n) => {
    const k = (n + h * 6) % 6;
    return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `#${[f(5), f(3), f(1)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

function buildTag(entry) {
  const text = entry.Tag || "";
  if (!text) return "";

  const hex1 = rgbStringToHex(entry.Color);
  const hex2 = rgbStringToHex(entry.Color2 || entry.Color);

  let inner;
  if (entry.Rainbow) inner = rainbow(text);
  else if (hex1 !== hex2) inner = gradient(text, hex1, hex2);
  else inner = `<font color="${hex1}">${escapeLua(text)}</font>`;

  if (entry.Bold) inner = `<b>${inner}</b>`;
  if (entry.Italic) inner = `<i>${inner}</i>`;

  return inner;
}


const app = express();

function checkApiKey(req, res, next) {
  const key = process.env.API_KEY;
  if (!key || req.headers["x-api-key"] === key) return next();
  return res.status(401).json({ error: "unauthorized" });
}

app.get("/", (req, res) => res.send("ok"));

app.get("/tags/groups", checkApiKey, (req, res) => {
  const tags = readJsonObject(GROUP_TAGS_PATH);
  res.json(tags);
});


const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log("Web server running on port", PORT);
});


const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName("createtag")
    .setDescription("Create Roblox crew tags")
    .addSubcommand((sub) =>
      sub
        .setName("crew")
        .setDescription("Create a group tag")
        .addIntegerOption((o) =>
          o.setName("groupid").setDescription("Roblox GroupId").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("tag").setDescription("Tag text").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("color").setDescription("R,G,B").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("color2").setDescription("R,G,B").setRequired(true)
        )
        .addBooleanOption((o) => o.setName("bold"))
        .addBooleanOption((o) => o.setName("italic"))
        .addBooleanOption((o) => o.setName("rainbow"))
    ),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID
    ),
    { body: commands }
  );
}

client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;
  if (i.commandName !== "createtag") return;

  const id = i.options.getInteger("groupid", true);
  const tag = i.options.getString("tag", true);
  const c1 = validateRGBString(i.options.getString("color", true));
  const c2 = validateRGBString(i.options.getString("color2", true));

  if (!c1 || !c2)
    return i.reply({ content: "Invalid RGB format", ephemeral: true });

  const entry = {
    Tag: tag,
    Color: c1,
    Color2: c2,
    Bold: i.options.getBoolean("bold") ?? false,
    Italic: i.options.getBoolean("italic") ?? false,
    Rainbow: i.options.getBoolean("rainbow") ?? false,
  };

  const tags = readJsonObject(GROUP_TAGS_PATH);

  tags[String(id)] = {
    order: 0,
    requiredRank: 1,
    tagName: buildTag(entry),
    tagStyle: "Discord",
  };

  writeJsonObject(GROUP_TAGS_PATH, tags);

  await i.reply(` Crew tag saved for group **${id}**`);
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

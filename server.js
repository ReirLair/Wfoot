const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public')); // Serve public folder

// Load players.json at startup
let playersData = JSON.parse(fs.readFileSync('players.json', 'utf-8')).players;

// Track assigned player IDs to avoid duplicates
let assignedPlayerIds = new Set();
if (fs.existsSync('users.json')) {
  const users = JSON.parse(fs.readFileSync('users.json'));
  users.forEach(user => {
    Object.values(user.players).flat().forEach(player => {
      assignedPlayerIds.add(player.id);
    });
  });
}

// Helper to get lowest-rated unassigned players
function getLowestRatedPlayers(position, count = 1) {
  const players = playersData[position];
  if (!players || players.length === 0) return [];

  const unassigned = players.filter(p => !assignedPlayerIds.has(p.id));

  const sorted = [...unassigned].sort((a, b) => a.rating - b.rating);

  const selectedPlayers = count === 1 ? [sorted[0]] : sorted.slice(0, count);

  selectedPlayers.forEach(p => assignedPlayerIds.add(p.id));

  return count === 1 ? selectedPlayers[0] : selectedPlayers;
}

// Register endpoint
app.post('/register', (req, res) => {
  const { teamName, playerName, password } = req.body;

  if (!teamName || !playerName || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let users = [];
  if (fs.existsSync('users.json')) {
    users = JSON.parse(fs.readFileSync('users.json'));

    if (users.find(u => u.playerName === playerName)) {
      return res.status(400).json({ error: 'Player name already taken' });
    }
  }

  const assignedPlayers = {
    cf: getLowestRatedPlayers('cf'),
    rwf: getLowestRatedPlayers('rwf'),
    lwf: getLowestRatedPlayers('lwf'),
    mf: getLowestRatedPlayers('mf', 3),
    df: getLowestRatedPlayers('df', 4),
    gk: getLowestRatedPlayers('gk'),
    subs: getLowestRatedPlayers('subs', 3),
  };

  const userData = {
    teamName,
    playerName,
    password, // You should hash this in production!
    players: assignedPlayers,
    coins: 500
  };

  users.push(userData);
  fs.writeFileSync('users.json', JSON.stringify(users, null, 2));

  res.json({ message: 'Team created successfully!', players: assignedPlayers, coins: 500 });
});

app.post('/login', (req, res) => {
  const { playerName, password } = req.body;

  if (!playerName || !password) {
    return res.status(400).json({ error: 'Player name and password are required' });
  }

  // Check if users.json exists
  if (!fs.existsSync('users.json')) {
    return res.status(404).json({ error: 'Users data not found' });
  }

  // Read the users data
  const users = JSON.parse(fs.readFileSync('users.json'));

  // Find the user by player name
  const user = users.find(u => u.playerName === playerName);

  // If user not found
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Check if the password matches
  if (user.password !== password) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  // Return user data (excluding password for security)
  const { password: _, ...userData } = user;

  res.json({
    message: 'Login successful',
    user: userData
  });
});

// Fetch user team endpoint
app.get('/team/:playerName', (req, res) => {
  const { playerName } = req.params;

  if (!fs.existsSync('users.json')) {
    return res.status(404).json({ error: 'No users found' });
  }

  const users = JSON.parse(fs.readFileSync('users.json'));
  const user = users.find(u => u.playerName === playerName);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({
    teamName: user.teamName,
    playerName: user.playerName,
    players: user.players,
    coins: user.coins
  });
});

// Fetch player by ID
app.get('/player/:id', (req, res) => {
  const playerId = parseInt(req.params.id);

  let foundPlayer = null;

  for (const position in playersData) {
    const player = playersData[position].find(p => p.id === playerId);
    if (player) {
      foundPlayer = player;
      break;
    }
  }

  if (!foundPlayer) {
    return res.status(404).json({ error: 'Player not found' });
  }

  res.json({
    id: foundPlayer.id,
    name: foundPlayer.name,
    rating: foundPlayer.rating
  });
});

// Helper: Get player position from players.json by ID
function getPlayerRealPosition(playerId) {
  for (const position in playersData) {
    const player = playersData[position].find(p => p.id === playerId);
    if (player) {
      return position;
    }
  }
  return null;
}

// Substitute endpoint with real position checking
app.post('/substitute', (req, res) => {
  const { playerName, outPlayerId, inPlayerId } = req.body;

  if (!playerName || outPlayerId === undefined || inPlayerId === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!fs.existsSync('users.json')) {
    return res.status(404).json({ error: 'No users found' });
  }

  const users = JSON.parse(fs.readFileSync('users.json'));
  const userIndex = users.findIndex(u => u.playerName === playerName);

  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  const user = users[userIndex];
  let outPlayerPos = null;
  let outPlayerData = null;
  let inPlayerPos = null;
  let inPlayerData = null;

  // Step 1: Find both players in user's team
  for (const position in user.players) {
    const playersInPosition = Array.isArray(user.players[position]) ? user.players[position] : [user.players[position]];

    playersInPosition.forEach(player => {
      if (player.id === outPlayerId) {
        outPlayerPos = position;
        outPlayerData = player;
      }
      if (player.id === inPlayerId) {
        inPlayerPos = position;
        inPlayerData = player;
      }
    });
  }

  if (!outPlayerData || !inPlayerData) {
    return res.status(404).json({ error: 'Both players must be in your team to substitute' });
  }

  // Step 2: Get real positions from players.json
  const realOutPosition = getPlayerRealPosition(outPlayerId);
  const realInPosition = getPlayerRealPosition(inPlayerId);

  if (!realOutPosition || !realInPosition) {
    return res.status(404).json({ error: 'Player not found in players database' });
  }

  // Step 3: Allow substitution only if real positions match
  if (realOutPosition !== realInPosition) {
    return res.status(400).json({ error: `Invalid substitution: ${realOutPosition.toUpperCase()} can only be swapped with ${realOutPosition.toUpperCase()}` });
  }

  // Step 4: Perform the substitution in user data
  const swapPlayers = (positionKey) => {
    if (Array.isArray(user.players[positionKey])) {
      user.players[positionKey] = user.players[positionKey].map(player => {
        if (player.id === outPlayerId) return inPlayerData;
        if (player.id === inPlayerId) return outPlayerData;
        return player;
      });
    } else {
      if (user.players[positionKey].id === outPlayerId) user.players[positionKey] = inPlayerData;
      else if (user.players[positionKey].id === inPlayerId) user.players[positionKey] = outPlayerData;
    }
  };

  // Swap positions in user.players
  swapPlayers(outPlayerPos);
  if (outPlayerPos !== inPlayerPos) {
    swapPlayers(inPlayerPos);
  }

  // Save changes
  users[userIndex] = user;
  fs.writeFileSync('users.json', JSON.stringify(users, null, 2));

  res.json({ message: 'Substitution completed successfully', players: user.players });
});

// Add new player to subs endpoint
app.post('/add-sub', (req, res) => {
  const { playerName, newPlayerId } = req.body;

  if (!playerName || newPlayerId === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!fs.existsSync('users.json')) {
    return res.status(404).json({ error: 'No users found' });
  }

  const users = JSON.parse(fs.readFileSync('users.json'));
  const userIndex = users.findIndex(u => u.playerName === playerName);

  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  const user = users[userIndex];

  // Step 1: Find the player in players.json
  let foundPlayer = null;
  for (const position in playersData) {
    const player = playersData[position].find(p => p.id === newPlayerId);
    if (player) {
      foundPlayer = player;
      break;
    }
  }

  if (!foundPlayer) {
    return res.status(404).json({ error: 'Player not found in database' });
  }

  // Step 2: Check if player is already assigned
  if (assignedPlayerIds.has(foundPlayer.id)) {
    return res.status(400).json({ error: 'Player is already assigned to a team' });
  }

  // Step 3: Add to user's subs
  if (!Array.isArray(user.players.subs)) {
    user.players.subs = [];
  }

  user.players.subs.push(foundPlayer);

  // Step 4: Mark as assigned and save
  assignedPlayerIds.add(foundPlayer.id);
  users[userIndex] = user;
  fs.writeFileSync('users.json', JSON.stringify(users, null, 2));

  res.json({ message: 'Player added to substitutes successfully!', player: foundPlayer });
});

function simulateGoals(attackingTeam, defendingTeam) {
  let goals = 0;
  let scorers = [];
  let assists = [];

  const attackers = [
    attackingTeam.players.cf,
    attackingTeam.players.rwf,
    attackingTeam.players.lwf,
    ...attackingTeam.players.mf
  ].filter(Boolean);

  const midfielders = attackingTeam.players.mf.filter(Boolean);
  const defenders = [
    ...defendingTeam.players.df,
    defendingTeam.players.gk
  ].filter(Boolean);

  const totalAttack = attackers.reduce((sum, p) => sum + p.rating, 0) / attackers.length;
  const totalDefense = defenders.reduce((sum, p) => sum + p.rating, 0) / defenders.length;

  const chanceCount = Math.floor(Math.random() * 3) + 3; // 3 to 5 chances
  let usedTimes = new Set();

  function getUniqueRandomMinute() {
    let minute;
    do {
      minute = Math.floor(Math.random() * 90) + 1; // 1 to 90
    } while (usedTimes.has(minute));
    usedTimes.add(minute);
    return minute;
  }

  for (let i = 0; i < chanceCount; i++) {
    const randomAttacker = attackers[Math.floor(Math.random() * attackers.length)];
    const attackStrength = randomAttacker.rating + Math.random() * 10;
    const defenseStrength = totalDefense + Math.random() * 10;

    if (attackStrength > defenseStrength) {
      goals++;

      const goalTime = getUniqueRandomMinute();
      scorers.push({ name: randomAttacker.name, id: randomAttacker.id, time: goalTime + "'" });

      // Assists - mostly midfielders
      let assisterPool = Math.random() < 0.7 && midfielders.length > 0 ? midfielders : attackers;
      const randomAssister = assisterPool[Math.floor(Math.random() * assisterPool.length)];

      if (randomAssister && randomAssister.id !== randomAttacker.id) { // prevent self-assist
        assists.push({ name: randomAssister.name, id: randomAssister.id });
      }
    }
  }

  // Sort scorers by time for realism
  scorers.sort((a, b) => parseInt(a.time) - parseInt(b.time));

  return { goals, scorers, assists };
}

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Route for the register page
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Route for the lobby page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lobby.html'));
});

app.listen(3000, () => console.log('Server running on port 3000'));
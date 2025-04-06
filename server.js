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

// Add these endpoints to your existing backend

// Get waiting list
app.get('/get-waiting-list', (req, res) => {
  const waitingFile = './waiting.json';
  
  fs.readFile(waitingFile, 'utf8', (err, data) => {
    if (err && err.code !== 'ENOENT') {
      return res.status(500).json({ error: 'Failed to read waiting list' });
    }

    const waitingList = data ? JSON.parse(data) : [];
    res.json({ waitingList });
  });
});

// Check for match
app.get('/check-match', (req, res) => {
  const waitingFile = './waiting.json';
  
  fs.readFile(waitingFile, 'utf8', (err, data) => {
    if (err && err.code !== 'ENOENT') {
      return res.status(500).json({ error: 'Failed to read waiting list' });
    }

    let waitingList = data ? JSON.parse(data) : [];
    
    if (waitingList.length >= 2) {
      const shuffled = waitingList.sort(() => 0.5 - Math.random());
      const matchedPlayers = shuffled.slice(0, 2);
      
      // Remove matched players from waiting list
      waitingList = waitingList.filter(player => !matchedPlayers.includes(player));
      
      // Save updated waiting list
      fs.writeFile(waitingFile, JSON.stringify(waitingList, null, 2), (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to update waiting list' });
        }
        
        return res.json({ matched: matchedPlayers });
      });
    } else {
      return res.json({ waiting: true });
    }
  });
});

// Remove from waiting list
app.post('/remove-from-waiting', (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const waitingFile = './waiting.json';
  
  fs.readFile(waitingFile, 'utf8', (err, data) => {
    if (err && err.code !== 'ENOENT') {
      return res.status(500).json({ error: 'Failed to read waiting list' });
    }

    let waitingList = data ? JSON.parse(data) : [];
    waitingList = waitingList.filter(player => player !== username);
    
    fs.writeFile(waitingFile, JSON.stringify(waitingList, null, 2), (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to update waiting list' });
      }
      
      return res.json({ success: true });
    });
  });
});

// Enhanced match simulation
const waitingFile = path.join(__dirname, 'waiting.json');
if (!fs.existsSync(waitingFile)) {
  fs.writeFileSync(waitingFile, JSON.stringify([]));
}

// Get team data endpoint
app.get('/team/:username', (req, res) => {
  const { username } = req.params;
  
  if (!fs.existsSync('users.json')) {
    return res.status(404).json({ error: 'No users found' });
  }

  const users = JSON.parse(fs.readFileSync('users.json'));
  const team = users.find(u => u.playerName === username);

  if (!team) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(team);
});

// Add to waiting list endpoint
app.post('/add-to-waiting', (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  // Verify user exists
  if (!fs.existsSync('users.json')) {
    return res.status(404).json({ error: 'Users data not found' });
  }

  const users = JSON.parse(fs.readFileSync('users.json'));
  const userExists = users.some(u => u.playerName === username);
  
  if (!userExists) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Read and update waiting list
  fs.readFile(waitingFile, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read waiting list' });
    }

    let waitingList = JSON.parse(data);
    
    // Prevent duplicate entries
    if (waitingList.includes(username)) {
      return res.json({ message: 'User already in waiting list', waiting: true });
    }

    // Add the user to the waiting list
    waitingList.push(username);

    // If there are at least 2 players, match them
    if (waitingList.length >= 2) {
      const shuffled = [...waitingList].sort(() => 0.5 - Math.random());
      const matchedPlayers = shuffled.slice(0, 2);
      
      // Remove matched players from waiting list
      waitingList = waitingList.filter(player => !matchedPlayers.includes(player));

      // Save updated waiting list
      fs.writeFile(waitingFile, JSON.stringify(waitingList), (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to update waiting list' });
        }

        return res.json({ matched: matchedPlayers });
      });
    } else {
      // Save updated waiting list
      fs.writeFile(waitingFile, JSON.stringify(waitingList), (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to update waiting list' });
        }

        return res.json({ waiting: true });
      });
    }
  });
});

// Enhanced match simulation with coin rewards
app.post('/match', (req, res) => {
  const { player1, player2 } = req.body;

  if (!player1 || !player2) {
    return res.status(400).json({ error: 'Both player names are required' });
  }

  if (!fs.existsSync('users.json')) {
    return res.status(404).json({ error: 'No users found' });
  }

  const users = JSON.parse(fs.readFileSync('users.json'));
  const team1 = users.find(u => u.playerName === player1);
  const team2 = users.find(u => u.playerName === player2);

  if (!team1 || !team2) {
    return res.status(404).json({ error: 'One or both users not found' });
  }

  // Simulate match
  const team1Goals = simulateGoals(team1, team2);
  const team2Goals = simulateGoals(team2, team1);
  
  // Determine winner and calculate coin reward based on score gap
  let winner = null;
  let coinReward = 0;
  const scoreDiff = Math.abs(team1Goals.totalGoals - team2Goals.totalGoals);
  
  if (team1Goals.totalGoals > team2Goals.totalGoals) {
    winner = team1.playerName;
    // Base 500 + up to 500 more based on score difference (max 5 goal difference)
    coinReward = 500 + Math.min(scoreDiff, 5) * 100;
  } else if (team2Goals.totalGoals > team1Goals.totalGoals) {
    winner = team2.playerName;
    coinReward = 500 + Math.min(scoreDiff, 5) * 100;
  } else {
    // Draw - both players get 250 coins
    coinReward = 250;
  }

  // Update coins for both players
  const updatedUsers = users.map(user => {
    if (user.playerName === winner) {
      return { ...user, coins: (user.coins || 0) + coinReward };
    } else if (team1Goals.totalGoals === team2Goals.totalGoals && 
              (user.playerName === player1 || user.playerName === player2)) {
      // Both players get coins for draw
      return { ...user, coins: (user.coins || 0) + coinReward };
    }
    return user;
  });

  // Save updated user data
  fs.writeFileSync('users.json', JSON.stringify(updatedUsers, null, 2));

  // Prepare match stats
  const stats = {
    team1Goals: team1Goals.totalGoals,
    team2Goals: team2Goals.totalGoals,
    team1Shots: team1Goals.totalShots,
    team2Shots: team2Goals.totalShots,
    team1Possession: Math.floor(Math.random() * 20) + 40,
    team2Possession: 100 - (Math.floor(Math.random() * 20) + 40),
    team1Corners: Math.floor(team1Goals.totalGoals * 1.5) + Math.floor(Math.random() * 3),
    team2Corners: Math.floor(team2Goals.totalGoals * 1.5) + Math.floor(Math.random() * 3),
    team1Fouls: Math.floor(Math.random() * 15),
    team2Fouls: Math.floor(Math.random() * 15),
    coinReward: coinReward
  };
  
  // Combine all goals in timeline
  const allGoals = [
    ...team1Goals.goals.map(g => ({
      ...g,
      team: team1.teamName || team1.playerName
    })),
    ...team2Goals.goals.map(g => ({
      ...g,
      team: team2.teamName || team2.playerName
    }))
  ].sort((a, b) => parseInt(a.time) - parseInt(b.time));
  
  res.json({
    winner,
    stats,
    goals: allGoals,
    team1: team1.teamName || team1.playerName,
    team2: team2.teamName || team2.playerName,
    coinReward
  });
});

// Goal simulation function (unchanged)
function simulateGoals(attackingTeam, defendingTeam) {
  let goals = [];
  let totalShots = Math.floor(Math.random() * 5) + 5; // 5-10 shots
  
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
  
  let usedTimes = new Set();

  function getUniqueRandomMinute() {
    let minute;
    do {
      minute = Math.floor(Math.random() * 90) + 1; // 1 to 90
    } while (usedTimes.has(minute));
    usedTimes.add(minute);
    return minute;
  }

  for (let i = 0; i < totalShots; i++) {
    const randomAttacker = attackers[Math.floor(Math.random() * attackers.length)];
    const attackStrength = randomAttacker.rating + Math.random() * 10;
    const defenseStrength = totalDefense + Math.random() * 10;

    if (attackStrength > defenseStrength) {
      const goalTime = getUniqueRandomMinute();
      
      let assister = null;
      if (Math.random() < 0.7 && midfielders.length > 0) {
        const randomAssister = midfielders[Math.floor(Math.random() * midfielders.length)];
        if (randomAssister && randomAssister.id !== randomAttacker.id) {
          assister = randomAssister.name;
        }
      }
      
      goals.push({
        scorer: randomAttacker.name,
        assist: assister,
        time: goalTime + "'"
      });
    }
  }
  
  return {
    totalGoals: goals.length,
    totalShots: totalShots,
    goals: goals
  };
}

// Other endpoints (get-waiting-list, check-match, remove-from-waiting) remain the same
// ... [include the other endpoints from your original code]

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Route for the register page
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/matchmake', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'matchmake.html'));
});

// Route for the lobby page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lobby.html'));
});

app.listen(3000, () => console.log('Server running on port 3000'));

require('dotenv').config();
wrapper = require('api-wrapper');
mysql = require('mysql');

forum = wrapper.create({
  root: process.env.XF_URL + '/api/',
  parseJson: true,
  requestDefaults: {
    headers: { 'XF-Api-Key': process.env.XF_API_KEY },
  },
  get: {
    getThreads: 'threads/',
    getThread: 'threads/${id}/',
    getUser: 'users/${id}/',
    getForum: 'forums/wn/${id}/threads/',
    getMessage: 'posts/${id}/',
  },
  post: {
    postMessage: 'posts/?thread_id|message',
    updateThread: 'threads/${id}/?prefix_id|title|discussion_open|sticky|custom_fields|add_tags|remove_tags',
    setThreadTag: 'threads/${id}/?custom_fields[${tag_name}]=${tag_value}',
  },
});

forumDb = undefined;
panelDb = undefined;
appealCache = [];

function dbConnect() {
  forumDb = mysql.createConnection({
    host: process.env.XF_DB_HOST,
    user: process.env.XF_DB_USER,
    password: process.env.XF_DB_PASS,
    database: process.env.XF_DB_NAME,
  });

  panelDb = mysql.createConnection({
    host: process.env.PANEL_DB_HOST,
    user: process.env.PANEL_DB_USER,
    password: process.env.PANEL_DB_PASS,
    database: process.env.PANEL_DB_NAME,
  });

  forumDb.connect(function (err) {
    if (err) {
      console.log('[MYSQL] ' + err);
      //setTimeout(dbConnect, 2000)
    } else {
      console.log('[MYSQL] Connected to forum database!');
    }
  });

  panelDb.connect(function (err) {
    if (err) {
      console.log('[MYSQL] ' + err);
      //setTimeout(dbConnect, 2000)
    } else {
      console.log('[MYSQL] Connected to panel database!');
    }
  });

  forumDb.on('error', function (err) {
    console.log('[MYSQL] Error!');
    console.log(err);

    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      console.log('[MYSQL] Reconnecting...');
      dbConnect();
    } else {
      throw err;
    }
  });

  panelDb.on('error', function (err) {
    console.log('[MYSQL] Error!');
    console.log(err);

    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      console.log('[MYSQL] Reconnecting...');
      dbConnect();
    } else {
      throw err;
    }
  });
}

function getBanAppeals() {
  forum.getForum({ id: process.env.FORUM_NODE_ID }, '', function (body) {
    body.threads.forEach(function (val) {
      if ((val.prefix_id === 0) & val.title.toLowerCase().includes('ban appeal') && appealCache.includes(val.thread_id) === false) {
        appealCache.push(val.thread_id);
        checkBanAppeal(val.title, val.thread_id, val.user_id);
      }
    });
  });
}

function checkBanAppeal(title, threadid, userid) {
  getUserSteamID(userid, function (steamid) {
    getBanOnUser(steamid, function (banInfo) {
      getForumUserBySteamID(banInfo.steamid64_admin, function (gotIt, adminUID) {
        forum.getThread({ id: threadid }, '', function (c) {
          forum.getMessage({ id: c.thread.first_post_id }, '', function (body) {
            if (body.post.message.toLowerCase().includes('[b]are you appealing an expired ban or a warning?:[/b] yes')) {
              return;
            }

            console.log('Found new appeal from ' + steamid + ' (' + userid + ') for ban #' + banInfo.id);

            const unbanDate = new Date(banInfo.date_banned.getTime() + 60 * (1000 * banInfo.length));
            const xenforoURL = 'https://willard.networks/forums/';

            p = '[B]Ban Information[/B]\n[LIST]';
            p = p + '\n[*][B]ID - [/B]#' + banInfo.id.toString();
            p = p + '\n[*][B]Reason - [/B]' + banInfo.reason;

            if (banInfo.length === 0) {
              p = p + '\n[*][B]Expiry - [/B] Permanent';
            } else {
              p = p + '\n[*][B]Expiry - [/B]' + unbanDate.toString();
            }
            // xenforoURL + forums + thread + post
            p = p + '\n[*][B]User - [/B][URL=' + xenforoURL + '/index.php?t=user&id=' + steamid + "']" + steamid + '[/URL]';

            if (gotIt === true) {
              p = p + '\n[*][B]Moderator - [/B][USER=' + adminUID + ']' + banInfo.steamid64_admin + '[/USER]';
            } else {
              if (banInfo.steamid64_admin !== '0') {
                p = p + '\n[*][B]Moderator - [/B]' + banInfo.steamid64_admin;
              }
            }

            let p = p + '\n[/LIST]';
            p = p.replace(/\n/g, '\\n');

            forum.updateThread({ id: threadid, prefix_id: '7', title: title + ' - ' + steamid }, function () {});
            forum.postMessage({ thread_id: threadid, message: p }, '', function () {});
          });
        });
      });
    });
  });
}

function getUserSteamID(userid, callback) {
  forumDb.query("SELECT provider_key FROM xf_user_connected_account WHERE provider = 'steam' AND user_id = '" + userid + "'", function (err, result) {
    if (err) throw err;

    if (result.length > 0) {
      callback(result[0].provider_key.toString());
    }
  });
}

function getForumUserBySteamID(steamid, callback) {
  forumDb.query("SELECT user_id FROM xf_user_connected_account WHERE provider = 'steam' AND provider_key = '" + steamid + "'", function (err, result) {
    if (err) throw err;

    if (result.length > 0) {
      callback(true, result[0].user_id);
    } else {
      callback(false);
    }
  });
}

function getBanOnUser(steamid, callback) {
  panelDb.query(
    "SELECT id, date_banned, length, reason, steamid64_admin FROM gex_bans WHERE steamid64 = '" +
      steamid +
      "' AND status = '0' AND (length = 0 OR DATE_ADD(date_banned, INTERVAL length minute) > CURRENT_TIMESTAMP())",
    function (err, result) {
      if (err) throw err;

      if (result.length > 0) {
        callback(result[0]);
      }
    }
  );
}

function threadSetTitle(threadid, xTitle) {
  forum.updateThread({ id: threadid, title: xTitle }, function () {});
}

function setThreadData(threadid, value) {
  forum.updateThread({ id: threadid, custom_fields: value }, function () {});
}

const snooze = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
  if (forumDb === undefined || panelDb === undefined || (forumDb.state === 'disconnected') & (panelDb.state === 'disconnected')) {
    console.log('Trying to connect to the databases...');
    dbConnect();
    await snooze(5000);
  } else {
    getBanAppeals();
  }

  await snooze(5000);
  await main();
};

main().then(() => console.log('Done!'));

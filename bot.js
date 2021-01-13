// this code was just put together quickly and is pretty messy, you've been warned

wrapper = require("api-wrapper")
mysql = require("mysql")
auth = require("./auth.json")

forum = wrapper.create({
	root: auth.xf_url + "/api/",
	parseJson: true,
	requestDefaults: {
		headers: {"XF-Api-Key": auth.xf_token}
	},
	get: {
		getThreads: "threads/",
		getThread: "threads/${id}/",
		getUser: "users/${id}/",
		getForum: "forums/${id}/threads/",
		getMessage: "posts/${id}/"
	},
	post: {
		postMessage: "posts/?thread_id|message",
		updateThread: "threads/${id}/?prefix_id|title|discussion_open|sticky|custom_fields|add_tags|remove_tags",
		setThreadTag: "threads/${id}/?custom_fields[${tag_name}]=${tag_value}"
	}
})


forumDb = undefined
panelDb = undefined

function dbConnect() {
	forumDb = mysql.createConnection({
		host: auth.db_ip,
		user: auth.forum_user,
		password: auth.forum_pass,
		database: auth.forum_db
	})

	panelDb = mysql.createConnection({
		host: auth.db_ip,
		user: auth.panel_user,
		password: auth.panel_pass,
		database: auth.panel_db
	})

	forumDb.connect(function(err) {
		if (err) {
			console.log("[MYSQL] " + err)
			//setTimeout(dbConnect, 2000)
		} 
		else {
			console.log("[MYSQL] Connected to forum database!")
		}
	})

	panelDb.connect(function(err) {
		if (err) {
			console.log("[MYSQL] " + err)
			//setTimeout(dbConnect, 2000)
		} 
		else {
			console.log("[MYSQL] Connected to panel database!")
		}
	})

	forumDb.on('error', function(err) {
		console.log("[MYSQL] Error!")
		console.log(err)

		if (err.code === "PROTOCOL_CONNECTION_LOST") {
			//dbConnect()
		} 
		else {
			throw err
		}
	});

	panelDb.on('error', function(err) {
		console.log("[MYSQL] Error!")
		console.log(err)

		if (err.code === "PROTOCOL_CONNECTION_LOST") {
			dbConnect()
		} 
		else {
			throw err
		}
	});
}


function getBanAppeals() {
	forum.getForum({id: 10}, "", function(error, message, body) {
		body.threads.forEach(function(val) {
			if (val.prefix_id == 0 & val.title.toLowerCase().includes("ban appeal")) {
				checkBanAppeal(val.title, val.thread_id, val.custom_fields, val.user_id)
			}
		})
	})
}

function checkBanAppeal(title, threadid, data, userid) {
	getUserSteamID(userid, function(steamid) {
		getBanOnUser(steamid, function(banInfo) {
			getForumUserBySteamID(banInfo.steamid64_admin, function(gotIt, adminUID) {
				forum.getThread({id: threadid}, "", function(z, x, c) {
					forum.getMessage({id: c.thread.first_post_id}, "", function(error, msg, body) {
						if (body.post.message.toLowerCase().includes("[b]are you appealing an expired ban or a warning?:[/b] yes")) {
							return
						}

						console.log("Found new appeal from "+steamid+" ("+userid+") for ban #"+banInfo.id)
						forum.updateThread({id: threadid, prefix_id: "7", title: title + " - " + steamid}, "", function() {})

						var unbanDate = new Date(banInfo.date_banned.getTime() + (60 * (1000 * banInfo.length)))
						var isIAC = false

						p = "[B]Ban Information[/B]\n[LIST]"
						p = p + "\n[*][B]ID - [/B]#" + banInfo.id.toString()
						p = p + "\n[*][B]Reason - [/B]" + banInfo.reason

						if (banInfo.length == 0) {
							p = p + "\n[*][B]Expiry - [/B] Permanent"
						}
						else {
							p = p + "\n[*][B]Expiry - [/B]" + unbanDate.toString()
						}

						p = p + "\n[*][B]User - [/B][URL='https://panel.impulse-community.com/index.php?t=user&id=" + steamid + "']" + steamid + "[/URL]"

						if (gotIt == true) {
							p = p + "\n[*][B]Moderator - [/B][USER=" + adminUID + "]" + banInfo.steamid64_admin + "[/USER]"
						}
						else {
							console.log("bruh")
							if (banInfo.steamid64_admin != "0") {
								p = p + "\n[*][B]Moderator - [/B]" + banInfo.steamid64_admin
							}
						}

						p = p + "\n[/LIST]"

						if (isIAC == true) {
							p = p + `\n\n[TABLE]
							[TR]
							[TD][B][SIZE=5][COLOR=rgb(226, 80, 65)]This ban was issued by IAC (impulse anti-cheat)
							IAC bans are permanent, non-negotiable and cannot be removed by appeal.[/COLOR][/SIZE][/B]
							[SIZE=3]If your IAC ban is determined to have been issued incorrectly, it will automatically be removed.[/SIZE]
							
							
							[B]How does IAC work?:[/B]
							IAC is an evidence based anti-cheat. It only issues bans when a cheat is detected directly. This means IAC does not conduct analysis, and does not issue false bans unless it is the result of a bug. In those cases the bans are automatically removed. For security purposes the exact methods IAC uses can not be disclosed, however IAC will scan actively for known traces of known cheats. IAC is non-intrusive and does not interfere, or be interfered with by other addons or other programs. Every IAC ban stores a case file containing evidence regarding your ban.
							
							[B]Are all IAC punishments permanent?:[/B]
							One of IAC's many detection methods which is used to prevent server crash exploits can flag false-positives. For this reason, this method will just kick users from the session unless it detects a very high reading. All other methods are completely based on evidence and can not be triggered by accident at all, therefore they all issue full IAC bans when they are triggered.[/TD]
							[/TR]
							[/TABLE]`

							forum.updateThread({id: threadid, discussion_open: false}, "", function() {})
						}
						p = escape(p)

						forum.postMessage({thread_id: threadid, message: p}, "", function() {})
					})
				})
			})
		})
	})
}

function getUserSteamID(userid, callback) {
	forumDb.query("SELECT provider_key FROM xf_user_connected_account WHERE provider = 'steam' AND user_id = '" + userid + "'", function(err, result) {
		if (err) throw err

		if (result.length > 0) {
			callback(result[0].provider_key.toString())
		}
	})
}

function getForumUserBySteamID(steamid, callback) {
	forumDb.query("SELECT user_id FROM xf_user_connected_account WHERE provider = 'steam' AND provider_key = '" + steamid + "'", function(err, result) {
		if (err) throw err

		if (result.length > 0) {
			callback(true, result[0].user_id)
		}
		else {
			callback(false)
		}
	})
}

function getBanOnUser(steamid, callback) {
	panelDb.query("SELECT id, date_banned, length, reason, steamid64_admin FROM gex_bans WHERE steamid64 = '" + steamid + "' AND status = '0' AND (length = 0 OR DATE_ADD(date_banned, INTERVAL length minute) > CURRENT_TIMESTAMP())", function(err, result) {
		if (err) throw err

		if (result.length > 0) {
			callback(result[0])
		}
	})
}

function threadSetTitle(threadid, xTitle) {
	forum.updateThread({title: xTitle}, "")
}

function setThreadData(threadid, value) {
	forum.updateThread({custom_fields: value}, "", function(error, msg, body) {
		//console.log(body)
	})
}

const snooze = ms => new Promise(resolve => setTimeout(resolve, ms));

const main = async () => {
	if ((forumDb === undefined || panelDb === undefined) || (forumDb.state == "disconnected" & panelDb.state == "disconnected")) {
		console.log("Trying to connect to the databases...")
		dbConnect()
		await snooze(5000)
	} 
	else {
		getBanAppeals()
	} 

	await snooze(5000)
	main()
};

main()
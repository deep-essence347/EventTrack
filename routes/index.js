require("dotenv").config();
var express = require("express");
var router = express.Router();
var passport = require("passport");
var async = require("async");
var nodemailer = require("nodemailer");
var crypto = require("crypto");
var User = require("../models/user");
var Event = require("../models/events");
var middleware = require("../middleware");
var multer = require("multer");
var storage = multer.diskStorage({
	filename: function (req, file, callback) {
		callback(null, Date.now() + file.originalname);
	},
});
var imageFilter = function (req, file, cb) {
	// accept image files only
	if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/i)) {
		return cb(new Error("Only image files are allowed!"), false);
	}
	cb(null, true);
};
var upload = multer({ storage: storage, fileFilter: imageFilter });

var cloudinary = require("cloudinary");
cloudinary.config({
	cloud_name: process.env.CLOUDINARY_NAME,
	api_key: process.env.CLOUDINARY_API_KEY,
	api_secret: process.env.CLOUDINARY_API_SECRET,
});

//Home Page Display
router.get("/", function (req, res) {
	res.render("index");
});

// Show Login Page
router.get("/login", function (req, res) {
	res.render("login");
});

// Handle Login POST request
router.post(
	"/login",
	passport.authenticate("local", {
		successRedirect: "/events",
		failureRedirect: "/login",
	}),
	function (req, res) {}
);

// Logout route
router.get("/logout", function (req, res) {
	req.logout();
	req.flash("success", "Logged you out!");
	res.redirect("/events");
});

//SHOW USER REGISTER (SIGN UP) FORM
router.get("/register", function (req, res) {
	res.render("register");
});

//Handle Sign Up POST logic
router.post("/register", upload.single("image"), function (req, res) {
	cloudinary.v2.uploader.upload(req.file.path, function (err, result) {
		if (err) {
			console.log(err);
			req.flash("error", err.message);
			return res.redirect("back");
		}
		var newUser = new User({
			firstName: req.body.firstName,
			lastName: req.body.lastName,
			email: req.body.email,
			username: req.body.username,
			contact_no: req.body.contact_no,
			image: result.secure_url,
			imageId: result.public_id,
			sex: req.body.sex,
			isVerified: false,
		});

		console.log(newUser);
		User.register(newUser, req.body.password, function (err, user) {
			if (err) {
				req.flash("error", err.message);
				console.log(err);
				return res.redirect("back");
			}
			passport.authenticate("local")(req, res, function () {
				req.flash("success", "Welcome to EventTrack " + user.username);
				res.redirect("/users/" + user.id);
				// done(err,token,user);
			});
		});
	});
});

//Account verification (Once the user clicks on verify button on user dashboard)
router.get("/:id/verify", function (req, res, next) {
	async.waterfall(
		[
			function (done) {
				crypto.randomBytes(20, function (err, buf) {
					var token = buf.toString("hex");
					console.log(token);
					done(err, token);
				});
			},
			function (token, done) {
				User.findOne({ _id: req.params.id }, function (err, user) {
					if (!user) {
						req.flash("error", "No account with that email address exists.");
						console.log("no account");
						return res.redirect("/verify");
					}
					user.verificationToken = token;
					user.verificationTokenExpires = Date.now() + 86400000; //1day

					user.save(function (err) {
						done(err, token, user);
					});
				});
			},
			function (token, user, done) {
				var smtpTransport = nodemailer.createTransport({
					service: "Gmail",
					auth: {
						user: process.env.GMAIL,
						pass: process.env.GMAILPASS,
					},
				});
				var mailOptions = {
					to: user.email,
					from: process.env.GMAIL,
					subject: "EventTrack User Account Verification.",
					text:
						"This is to verify your EventTrack user account.\n\n" +
						"Please click on the following link, or paste this into your browser to complete the process\n\n" +
						"http://" +
						req.headers.host +
						"/verify/" +
						token +
						"\n\n" +
						"The above verification link is valid only for a day.\n\n" +
						"If you did not create the account, please ignore this email.\n",
				};
				smtpTransport.sendMail(mailOptions, function (err) {
					console.log("mail sent");
					req.flash(
						"Success",
						"Your verification token has been sent to " +
							req.body.email +
							". Please follow the instructions as per the mail."
					);
					done(err, "done");
				});
			},
		],
		function (err) {
			if (err) return next(err);
			res.redirect("back");
		}
	);
});

//Verfiy the user (From eMail) using verification token
router.get("/verify/:token", function (req, res) {
	async.waterfall(
		[
			function (done) {
				User.findOne(
					{
						verificationToken: req.params.token,
						verificationTokenExpires: { $gt: Date.now() },
					},
					function (err, user) {
						if (!user) {
							req.flash(
								"error",
								"Verification token is invalid or has expired."
							);
							return res.redirect("back");
						}
						user.isVerified = true;
						user.verificationToken = undefined;
						user.verificationTokenExpires = undefined;
						user.save(function (err) {
							req.login(user, function (err) {
								done(err, user);
							});
						});
					}
				);
			},
		],
		function (err) {
			req.flash("Success", "Your Account has been verified.");
			res.redirect("/events");
		}
	);
});

//Show User Profile (Dashboard)
router.get("/users/:id", function (req, res) {
	User.findById(req.params.id, function (err, foundUser) {
		if (err) {
			req.flash(err, "Something went WRONG!");
			res.redirect("/");
		}
		Event.find()
			.where("author.id")
			.equals(foundUser._id)
			.exec(function (err, events) {
				if (err) {
					req.flash(err, "Something went WRONG!");
					res.redirect("/");
				}
				res.render("users/show", { user: foundUser, events: events });
			});
	});
});

//Show Forgot-password Page (where user enters his email)
router.get("/forgot-password", function (req, res) {
	res.render("users/forgotPassword");
});

//Handle Forgot Password POST Logics
router.post("/forgot-password", function (req, res, next) {
	async.waterfall(
		[
			function (done) {
				crypto.randomBytes(20, function (err, buf) {
					var token = buf.toString("hex");
					done(err, token);
				});
			},
			function (token, done) {
				User.findOne({ email: req.body.email }, function (err, user) {
					if (!user) {
						req.flash("error", "No account with that email address exists.");
						return res.redirect("/forgot-password");
					}
					user.resetPasswordToken = token;
					user.resetPasswordExpires = Date.now() + 3600000; //1hour

					user.save(function (err) {
						done(err, token, user);
					});
				});
			},
			function (token, user, done) {
				var smtpTransport = nodemailer.createTransport({
					service: "Gmail",
					auth: {
						user: process.env.GMAIL,
						pass: process.env.GMAILPASS,
					},
				});
				var mailOptions = {
					to: user.email,
					from: process.env.GMAIL,
					subject: "EventTrack User Account Password Reset",
					text:
						"You are receiving this because you (or someone else) have requested to reset the password of your EventTrack account.\n\n" +
						"Please click on the following link, or paste this into your browser to complete the process\n\n" +
						"http://" +
						req.headers.host +
						"/reset/" +
						token +
						"\n\n" +
						"If you did not request this, please ignore this email and your password will remain unchanged.\n",
				};
				smtpTransport.sendMail(mailOptions, function (err) {
					console.log("mail sent");
					req.flash(
						"Success",
						"An e-mail has been sent to " +
							user.email +
							"with further instructions."
					);
					done(err, "done");
				});
			},
		],
		function (err) {
			if (err) return next(err);
			res.redirect("/forgot-password");
		}
	);
});

//CREATE NEW PASSWORD SHOW PAGE (ACCESSBILE From e-mail link) //RESET-PASS
router.get("/reset/:token", function (req, res) {
	User.findOne(
		{
			resetPasswordToken: req.params.token,
			resetPasswordExpires: { $gt: Date.now() },
		},
		function (err, user) {
			if (!user) {
				req.flash("error", "Password reset token is invalid or has expired.");
				return res.redirect("/forgot-password");
			}
			res.render("users/resetPassword", { token: req.params.token });
		}
	);
});

//RESET PASSWORD POST LOGIC (After NEW password is entered)
router.post("/reset/:token", function (req, res) {
	async.waterfall(
		[
			function (done) {
				User.findOne(
					{
						resetPasswordToken: req.params.token,
						resetPasswordExpires: { $gt: Date.now() },
					},
					function (err, user) {
						if (!user) {
							req.flash(
								"error",
								"Password reset token is invalid or has expired."
							);
							return res.redirect("back");
						}

						if (req.body.password === req.body.confirm) {
							user.setPassword(req.body.password, function (err) {
								user.resetPasswordToken = undefined;
								user.resetPasswordExpires = undefined;
								user.save(function (err) {
									req.login(user, function (err) {
										done(err, user);
									});
								});
							});
						} else {
							req.flash("error", "Passwords do not match.");
							res.redirect("back");
						}
					}
				);
			},
			function (user, done) {
				var smtpTransport = nodemailer.createTransport({
					service: "Gmail",
					auth: {
						user: process.env.GMAIL,
						pass: process.env.GMAILPASS,
					},
				});
				var mailOptions = {
					to: user.email,
					from: process.env.GMAIL,
					subject: "EventTrack User Account Password Changed",
					text:
						"The password to your EventTrack account with username " +
						user.username +
						" has been changed.\n\n" +
						"In case you don't recognize this activity please contact the administration of the page. The contact details can be found in the page.\n",
				};
				smtpTransport.sendMail(mailOptions, function (err) {
					console.log("mail sent");
					req.flash("Success", "Your Password has been changed successfully!");
					done(err);
				});
			},
		],
		function (err) {
			res.redirect("/events");
		}
	);
});
router.post("/query", function (req, res) {
	async.waterfall(
		[
			function (done) {
				var smtpTransport = nodemailer.createTransport({
					service: "Gmail",
					auth: {
						user: process.env.GMAIL,
						pass: process.env.GMAILPASS,
					},
				});
				var mailOptions = {
					to: process.env.SUPPORT_GMAIL,
					from: process.env.GMAIL,
					subject: "EventTrack User wants to contact you.",
					text:
						"From: " +
						req.body.name +
						"\n" +
						"Email: " +
						req.body.email +
						"\n" +
						"Phone: " +
						req.body.phone +
						"\n" +
						"Message: " +
						req.body.message +
						"\n",
				};
				console.log(mailOptions);
				smtpTransport.sendMail(mailOptions, function (err) {
					console.log("mail sent to " + mailOptions.to);
					req.flash(
						"Success",
						"Your message has been sent. You will be contacted soon."
					);
					done(err);
					res.redirect("/");
				});
			},
		],
		function (err) {
			req.flash("Error", "An error has occurred. Please try again.");
			res.redirect("/");
		}
	);
});
module.exports = router;

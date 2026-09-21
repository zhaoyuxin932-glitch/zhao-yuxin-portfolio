const { ensureState, rotatePassword } = require("../server");

ensureState()
  .then(() => rotatePassword("manual rotation"))
  .then(() => {
    console.log("Password rotated.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

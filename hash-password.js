const bcrypt = require('bcrypt')

const password = 'accountant123'
bcrypt.hash(password, 10).then(hash => {
  console.log(`Hashed password for "${password}":`)
  console.log(hash)
})
<?php
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // Get the form data
    $name = $_POST['name'];
    $email = $_POST['email'];
    $message = $_POST['message'];

    // Here, you would typically process the data (like sending an email or saving it to a database)
    echo "Thank you, $name! Your message has been received.";
    // For now, just echo the data back to the user
    echo "<br>Name: $name";
    echo "<br>Email: $email";
    echo "<br>Message: $message";
}
?>

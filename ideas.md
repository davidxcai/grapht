# Todo

## important and priority

we still haven't tested a full end-to-end run of this

## privacy

by default, the trials are private. but if the user wants to share the trial, but also not leak their identity, they can choose to censor the face slightly so that the eyes are obscured. it'll just be a blurred bar. profiles are also private by default unless you choose to make it public. this is going to be a feature added later on, and is not part of the mvp.

## community trending

i want to have another category shown in the community page where it shows trending products where it's basically noting a high amount of recent usage in people's routines.

it features just the products itself, and clicking on it would take you to the product details page.

# Done

## time since applying

for each trial, i'd like to add a feature where it also tells us how long after your routine application you took your picture.
for example, i applied my morning routine products at 8 am. then i took a sample photo at 12pm. so that means it's the result of 4 hours.
when you look at the pictures, you want to be able to tell how long it took for the effects to show up and how it looks like when the products settle into your skin.

the user just presses a button like 'applied products' and it'll note the time they took it. so at night, i go the trial details and i press it at 10pm and it'll know that. so in the morning, i just take a picture when i'm ready and take the photo at 6am, so it'll automatically note the difference of 8 hours. once a picture has been taken, that 'applied products' doesn't reset, but it'll stay at 10pm as a default in case you forget to check in. so the next morning you take the photo again at 7am, it'll note a difference of 9 hours.

the check-in should be easily accessible so let the users have a quick button under the trial's title in the details page if they haven't checked in yet. once they have, just change it to say 'product applied' or something.

## dosage

this can be tricky, but if it's like a medication or something, then you'd have to probably specify the amount you used.

## additional photos

so besides the single daily skin analysis photo you take, you should also have the opportunity to add some additional photos with more shots at different angles not supported by the skin analysis api. this gives others more qualitative information, but the skin analysis photo will always be the default. so let's say on the 3rd day, i want to add 5 additional photos. on the skin analysis photo, it'll display the other photos below vertically under the carousel. swiping left or right on the carousel is the only way to see the next day. it'll open the rest of the photos below so you can just scroll down.

## notes

when the user uploads a new photo, i want them to have the option to add a note/comment to the photo. they should be able to edit/remove it later if they want to. it will show at the bottom of the picture, right above the day. the reason we want this is because sometimes a picture isn't enough to explain something that might've happened during that day (e.g. sunburned, rained, etc.). this gives more context for each photo.

## homescreen

on the homescreen, i don't want it to show the dashboard like we have now. instead, i need it to basically be marketing for what this app is. we need some kind of graphic do show what this app does at a glance, and it's main core focus is the facial analysis. you can track your skin progress over days.

then, we also talk about the community and how users can share their experiences of using products so that we have a standardized way to review and test products.

use a quick and easy motto like "hold your skincare accountable" as the hero section.
subtitle could be: start tracking your skincare products to see if they really work.
then a button that says start trial or something.

right below, i want to showcase the most recent completed trials so that the visitors can immediately see what this is.

the problem that we'll talk about is that there aren't a lot of credible reviews on websites and influencers/reviewers often don't show the full journey/progress. we give you all the data so that you can see exactly what people are using and how it affected them.

## community

this is one of the core components of this app - the community trials. you can see ongoing trials as well as completed trials.

this is free for visitors to browse and it's the thing that makes them want to do trials on it. they'll see how people are doing it and get a very good idea of what the app is. then they'll likely try it themselves once they see the value.

you can also search by product so you can see who has trialed the products you're interested in. when searching by product, you can look up product name, manufacturer/brand, or even search by ingredients. these are all filters for searching but the point is to have easier access to finding products that may work for you.

you can also browse by skin type as well as concerns so that you can see what other people are using. so i can search under 'oily' skin type and see what people use. i can search by 'acne' concern and see what others use. you should also be able to save someone's trial so you can view it under your saved trials later. if someone's profile is public, then you can view their skin care routines (like what they use during the day and night).

everyone's trials will have views if they set them to public. there will be a comment section as well for each trial. the trial's user can choose to enable/disable comments.

i want to emphasize that this is not a popularity or beauty contest. so the only thing you'll see is the number of views on the trial. maybe later on we can think about showing the number of 'saves'.

## profile

i think the user should use their full name but have an @ handle for the username so that people can also look them up by that in case their's multiple people with the same name.

## summary

when the trial is done, gemini is going to write an objective summary of what happened during the trial, and how things have changed (if any change at all). then, the user has the opportunity to review it as well and write whatever they like. this is the qualitative part of the trial that is used to convey more sentiment and thoughts on the products used.

## products

i want to implement an informative database of products/reviews here so that it's easy to find. my expectation is that when you start searching for products, it'll give you a list of products based on what filters you use. when you click on a product, it takes you to a product details page. in this page, it lists the product name, how many people in the community used it, its rating by the community, the common concern targets, the ingredient list, and then show a couple of trials where peolple have used it. if there's none, it'll say something like 'no onoe has tried it yet, be the first' and have a button to start a new trial.

we also want a picture of the product so that it's easy to visually verify the correct product.

## search

there should be a general search function where you can type in whatever you like, and it'll pull up trials, products, and users, in that order. they will be tabbed and have a number next to the tab name to represent how many results came up. for large numbers like 1000 and above, just use K (like 5k) or whatever else comes after that. it should support fuzzy search so we might possibly need to implement something that can handle that.
